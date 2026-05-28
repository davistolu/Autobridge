# frozen_string_literal: true

# WireBridge Ruby SDK
# Works with Rails, Sinatra, Rack, or plain Ruby.
#
# Usage:
#   bridge = WireBridge::Client.new(
#     service_name: "payment-service",
#     base_url: "http://localhost:3000"
#   )
#
#   bridge.capability(
#     name: "list payments",
#     handler: "/api/payments",
#     method: "GET",
#     tags: ["payments", "read"],
#     output: {
#       payments: WireBridge.array_of(
#         WireBridge.object_of(id: WireBridge.string, amount: WireBridge.number)
#       )
#     }
#   )
#
#   bridge.register

require "json"
require "net/http"
require "uri"
require "securerandom"
require "logger"

module WireBridge
  VERSION = "0.1.0"

  # ─── SCHEMA HELPERS ─────────────────────────────────────────────────────────

  def self.string(required: true, description: nil, example: nil)
    s = { type: "string", required: required }
    s[:description] = description if description
    s[:example] = example if example
    s
  end

  def self.number(required: true, description: nil, example: nil)
    s = { type: "number", required: required }
    s[:description] = description if description
    s
  end

  def self.boolean(required: true, description: nil)
    s = { type: "boolean", required: required }
    s[:description] = description if description
    s
  end

  def self.object_of(properties, required: true, description: nil)
    s = { type: "object", required: required, properties: properties }
    s[:description] = description if description
    s
  end

  def self.array_of(items, required: true, description: nil)
    s = { type: "array", required: required, items: items }
    s[:description] = description if description
    s
  end

  def self.optional(schema)
    schema.merge(required: false)
  end

  # ─── CLIENT ─────────────────────────────────────────────────────────────────

  class Client
    attr_reader :config, :capabilities

    def initialize(
      service_name:,
      base_url:,
      bridge_url: "http://localhost:7331",
      service_id: nil,
      version: "1.0.0",
      api_key: nil,
      heartbeat_interval: 30,
      logger: Logger.new($stdout)
    )
      @config = {
        service_name: service_name,
        base_url: base_url,
        bridge_url: bridge_url,
        service_id: service_id || "svc-#{SecureRandom.hex(4)}",
        version: version,
        api_key: api_key || ENV["WIREBRIDGE_ANTHROPIC_KEY"] || ENV["ANTHROPIC_API_KEY"],
        heartbeat_interval: heartbeat_interval
      }
      @capabilities = []
      @registered = false
      @logger = logger
      @heartbeat_thread = nil
    end

    # Register a capability — chainable.
    #
    # @param name [String] Human-readable capability name
    # @param handler [String] Route path, e.g. "/api/payments"
    # @param method [String] HTTP method (default: "GET")
    # @param output [Hash] Schema describing the response shape
    # @param input [Hash] Schema describing accepted parameters
    # @param tags [Array<String>] Semantic tags for matching
    # @param description [String] Optional description
    def capability(name:, handler:, output:, method: "GET", input: {}, tags: [], description: nil)
      id = "#{@config[:service_id]}.#{handler.gsub(/[^a-z0-9]/, '-')}"
      @capabilities << {
        id: id,
        name: name,
        handler: handler,
        method: method.upcase,
        output: output,
        input: input,
        tags: tags,
        description: description || "",
        stack: "ruby"
      }
      self
    end

    # Push the manifest to WireBridge and start heartbeat.
    def register(api_key: nil)
      key = api_key || @config[:api_key]
      manifest = build_manifest

      payload = { manifest: manifest }
      payload[:apiKey] = key if key

      uri = URI("#{@config[:bridge_url]}/registry/backend")
      http = Net::HTTP.new(uri.host, uri.port)
      http.open_timeout = 5
      http.read_timeout = 10

      request = Net::HTTP::Post.new(uri.path, "Content-Type" => "application/json")
      request.body = payload.to_json

      response = http.request(request)

      if response.code.to_i >= 400
        @logger.error("[WireBridge] Registration failed: #{response.code} #{response.body}")
        return false
      end

      @registered = true
      @logger.info("[WireBridge] ✓ Registered #{@capabilities.size} capabilities for '#{@config[:service_name]}'")
      start_heartbeat
      true
    rescue => e
      @logger.error("[WireBridge] Registration error: #{e.message}")
      false
    end

    # Stop the heartbeat thread.
    def stop
      @heartbeat_thread&.kill
    end

    private

    def build_manifest
      {
        serviceId: @config[:service_id],
        serviceName: @config[:service_name],
        version: @config[:version],
        baseUrl: @config[:base_url],
        stack: "ruby",
        capabilities: @capabilities,
        registeredAt: Time.now.utc.iso8601
      }
    end

    def start_heartbeat
      interval = @config[:heartbeat_interval]
      service_id = @config[:service_id]
      bridge_url = @config[:bridge_url]

      @heartbeat_thread = Thread.new do
        loop do
          sleep interval
          begin
            uri = URI("#{bridge_url}/registry/heartbeat")
            Net::HTTP.post(uri, { serviceId: service_id }.to_json, "Content-Type" => "application/json")
          rescue
            # Heartbeat failures are silent
          end
        end
      end
      @heartbeat_thread.abort_on_exception = false
    end
  end

  # ─── RAILS INTEGRATION ──────────────────────────────────────────────────────

  module Rails
    # Call in config/initializers/wirebridge.rb
    #
    # WireBridge::Rails.setup do |bridge|
    #   bridge.capability(name: "list users", handler: "/api/users", ...)
    # end
    def self.setup(bridge: nil, **opts, &block)
      @bridge = bridge || Client.new(**opts)
      yield @bridge if block_given?

      # Register after Rails boots
      if defined?(::Rails::Application)
        ::Rails.application.config.after_initialize do
          @bridge.register
        end
      else
        @bridge.register
      end

      @bridge
    end

    def self.bridge
      @bridge
    end
  end

  # ─── SINATRA INTEGRATION ────────────────────────────────────────────────────

  module Sinatra
    # Mixin for Sinatra apps
    #
    # class MyApp < Sinatra::Base
    #   include WireBridge::Sinatra
    #   wirebridge service_name: "my-api", base_url: "http://localhost:4567"
    # end
    def self.included(base)
      base.extend(ClassMethods)
    end

    module ClassMethods
      def wirebridge(**opts, &block)
        @_bridge = Client.new(**opts)
        yield @_bridge if block_given?

        configure do
          @_bridge.register
        end

        @_bridge
      end

      def bridge
        @_bridge
      end
    end
  end

  # ─── RACK MIDDLEWARE ────────────────────────────────────────────────────────

  # Rack middleware — registers capabilities on first request.
  #
  # use WireBridge::Middleware, service_name: "my-api", base_url: "http://localhost:9292" do |b|
  #   b.capability(name: "health check", handler: "/health", output: { status: WireBridge.string })
  # end
  class Middleware
    def initialize(app, **opts, &block)
      @app = app
      @bridge = Client.new(**opts)
      yield @bridge if block_given?
      @registered = false
      @mutex = Mutex.new
    end

    def call(env)
      @mutex.synchronize do
        unless @registered
          @bridge.register
          @registered = true
        end
      end
      @app.call(env)
    end
  end
end
