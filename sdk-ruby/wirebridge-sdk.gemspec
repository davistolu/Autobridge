Gem::Specification.new do |spec|
  spec.name        = "wirebridge-sdk"
  spec.version     = "0.1.0"
  spec.authors     = ["WireBridge"]
  spec.summary     = "WireBridge Ruby SDK — connect any Ruby backend to the WireBridge framework"
  spec.description = "Runtime wiring layer SDK for Ruby. Works with Rails, Sinatra, Rack, and plain Ruby."
  spec.homepage    = "https://github.com/wirebridge/sdk-ruby"
  spec.license     = "MIT"

  spec.files       = Dir["lib/**/*.rb"]
  spec.require_paths = ["lib"]

  spec.required_ruby_version = ">= 3.0"
  # No runtime dependencies — uses only Ruby stdlib (net/http, json, etc.)
end
