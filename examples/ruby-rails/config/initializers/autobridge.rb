# config/initializers/autobridge.rb
# Example: Rails backend with AutoBridge

require "autobridge"

AutoBridge::Rails.setup(
  service_name: "payment-service",
  base_url: "http://localhost:3000",
  # api_key: "sk-ant-..." # or set ANTHROPIC_API_KEY env var
) do |bridge|

  bridge
    .capability(
      name: "list payments",
      handler: "/api/payments",
      method: "GET",
      tags: %w[payments read list],
      output: {
        payments: AutoBridge.array_of(
          AutoBridge.object_of(
            id:         AutoBridge.string,
            amount:     AutoBridge.number,
            currency:   AutoBridge.string,
            status:     AutoBridge.string,
            created_at: AutoBridge.string
          )
        ),
        total: AutoBridge.number
      }
    )
    .capability(
      name: "create payment",
      handler: "/api/payments",
      method: "POST",
      tags: %w[payments create write],
      input: {
        amount:   AutoBridge.number(description: "Amount in cents"),
        currency: AutoBridge.string(description: "ISO 4217 currency code"),
        source:   AutoBridge.string(description: "Payment source token")
      },
      output: {
        payment: AutoBridge.object_of(
          id:     AutoBridge.string,
          status: AutoBridge.string
        )
      }
    )
    .capability(
      name: "get payment status",
      handler: "/api/payments/:id",
      method: "GET",
      tags: %w[payments read status],
      input: {
        id: AutoBridge.string
      },
      output: {
        payment: AutoBridge.object_of(
          id:         AutoBridge.string,
          status:     AutoBridge.string,
          amount:     AutoBridge.number,
          updated_at: AutoBridge.string
        )
      }
    )
    .capability(
      name: "refund payment",
      handler: "/api/payments/:id/refund",
      method: "POST",
      tags: %w[payments refund write],
      input: {
        id:     AutoBridge.string,
        amount: AutoBridge.optional(AutoBridge.number(description: "Partial refund amount"))
      },
      output: {
        refund: AutoBridge.object_of(
          id:     AutoBridge.string,
          status: AutoBridge.string
        )
      }
    )
end
