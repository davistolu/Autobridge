# config/initializers/wirebridge.rb
# Example: Rails backend with WireBridge

require "wirebridge"

WireBridge::Rails.setup(
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
        payments: WireBridge.array_of(
          WireBridge.object_of(
            id:         WireBridge.string,
            amount:     WireBridge.number,
            currency:   WireBridge.string,
            status:     WireBridge.string,
            created_at: WireBridge.string
          )
        ),
        total: WireBridge.number
      }
    )
    .capability(
      name: "create payment",
      handler: "/api/payments",
      method: "POST",
      tags: %w[payments create write],
      input: {
        amount:   WireBridge.number(description: "Amount in cents"),
        currency: WireBridge.string(description: "ISO 4217 currency code"),
        source:   WireBridge.string(description: "Payment source token")
      },
      output: {
        payment: WireBridge.object_of(
          id:     WireBridge.string,
          status: WireBridge.string
        )
      }
    )
    .capability(
      name: "get payment status",
      handler: "/api/payments/:id",
      method: "GET",
      tags: %w[payments read status],
      input: {
        id: WireBridge.string
      },
      output: {
        payment: WireBridge.object_of(
          id:         WireBridge.string,
          status:     WireBridge.string,
          amount:     WireBridge.number,
          updated_at: WireBridge.string
        )
      }
    )
    .capability(
      name: "refund payment",
      handler: "/api/payments/:id/refund",
      method: "POST",
      tags: %w[payments refund write],
      input: {
        id:     WireBridge.string,
        amount: WireBridge.optional(WireBridge.number(description: "Partial refund amount"))
      },
      output: {
        refund: WireBridge.object_of(
          id:     WireBridge.string,
          status: WireBridge.string
        )
      }
    )
end
