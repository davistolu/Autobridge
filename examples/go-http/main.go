// Example: Go backend with WireBridge
// Works with net/http, Gin, Echo, Chi, or any other Go HTTP framework.
package main

import (
	"encoding/json"
	"log"
	"net/http"

	wirebridge "github.com/wirebridge/sdk-go"
)

func main() {
	// ─── Configure WireBridge ───────────────────────────────────────────────
	bridge := wirebridge.New(wirebridge.Config{
		ServiceName: "inventory-service",
		BaseURL:     "http://localhost:8080",
		// APIKey: "sk-ant-...", // or set ANTHROPIC_API_KEY env var
	})

	// ─── Declare Capabilities ───────────────────────────────────────────────
	bridge.
		Capability(wirebridge.Cap{
			Name:    "list products",
			Handler: "/api/products",
			Method:  "GET",
			Tags:    []string{"products", "read", "list", "inventory"},
			Output: wirebridge.Schema{
				"products": wirebridge.ArrayOf(wirebridge.ObjectOf(wirebridge.Fields{
					"id":       wirebridge.String(),
					"name":     wirebridge.String(),
					"price":    wirebridge.Number(),
					"stock":    wirebridge.Number(),
					"category": wirebridge.Optional(wirebridge.String()),
				})),
				"total": wirebridge.Number(),
			},
		}).
		Capability(wirebridge.Cap{
			Name:        "get product by id",
			Handler:     "/api/products/{id}",
			Method:      "GET",
			Description: "Fetch a single product with full details",
			Tags:        []string{"products", "read", "detail"},
			Input: wirebridge.Schema{
				"id": wirebridge.String(),
			},
			Output: wirebridge.Schema{
				"product": wirebridge.ObjectOf(wirebridge.Fields{
					"id":          wirebridge.String(),
					"name":        wirebridge.String(),
					"price":       wirebridge.Number(),
					"description": wirebridge.Optional(wirebridge.String()),
					"stock":       wirebridge.Number(),
				}),
			},
		}).
		Capability(wirebridge.Cap{
			Name:    "create product",
			Handler: "/api/products",
			Method:  "POST",
			Tags:    []string{"products", "create", "write"},
			Input: wirebridge.Schema{
				"name":  wirebridge.String(),
				"price": wirebridge.Number(),
				"stock": wirebridge.Number(),
			},
			Output: wirebridge.Schema{
				"product": wirebridge.ObjectOf(wirebridge.Fields{
					"id":    wirebridge.String(),
					"name":  wirebridge.String(),
					"price": wirebridge.Number(),
				}),
			},
		})

	// ─── Register with WireBridge ───────────────────────────────────────────
	// MustRegister panics on failure — swap to Register() for graceful handling
	bridge.MustRegister()
	defer bridge.Stop()

	// ─── HTTP Routes ────────────────────────────────────────────────────────
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/products", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"products": []map[string]interface{}{
				{"id": "p1", "name": "Widget A", "price": 29.99, "stock": 150},
				{"id": "p2", "name": "Widget B", "price": 49.99, "stock": 43},
			},
			"total": 2,
		})
	})

	mux.HandleFunc("GET /api/products/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"product": map[string]interface{}{
				"id": id, "name": "Widget A", "price": 29.99, "stock": 150,
				"description": "A high-quality widget",
			},
		})
	})

	mux.HandleFunc("POST /api/products", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"product": map[string]interface{}{"id": "p3", "name": "New Widget", "price": 9.99},
		})
	})

	// Wrap with WireBridge middleware (auto-registers on first request as backup)
	log.Println("Inventory service listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", bridge.Middleware(mux)))
}
