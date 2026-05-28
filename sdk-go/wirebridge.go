// Package wirebridge provides WireBridge SDK for Go backends.
// Works with any HTTP framework: net/http, Gin, Echo, Chi, Fiber, etc.
//
// Usage:
//
//	bridge := wirebridge.New(wirebridge.Config{
//	    ServiceName: "order-service",
//	    BaseURL:     "http://localhost:8080",
//	})
//
//	bridge.Capability(wirebridge.Cap{
//	    Name:    "list orders",
//	    Handler: "/api/orders",
//	    Method:  "GET",
//	    Tags:    []string{"orders", "read"},
//	    Output: wirebridge.Schema{
//	        "orders": wirebridge.ArrayOf(wirebridge.ObjectOf(wirebridge.Fields{
//	            "id":     wirebridge.String(),
//	            "total":  wirebridge.Number(),
//	            "status": wirebridge.String(),
//	        })),
//	    },
//	})
//
//	bridge.Register()
package wirebridge

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"
)

// ─── SCHEMA TYPES ─────────────────────────────────────────────────────────────

// FieldSchema represents the type definition of a field in a capability's
// input or output. Mirrors the WireBridge manifest format.
type FieldSchema struct {
	Type        string                 `json:"type"`
	Required    bool                   `json:"required"`
	Description string                 `json:"description,omitempty"`
	Items       *FieldSchema           `json:"items,omitempty"`
	Properties  map[string]*FieldSchema `json:"properties,omitempty"`
	Enum        []interface{}          `json:"enum,omitempty"`
	Example     interface{}            `json:"example,omitempty"`
}

// Schema is a map of field name → FieldSchema.
type Schema map[string]*FieldSchema

// Fields is an alias for Schema used in ObjectOf for clarity.
type Fields = Schema

// Convenience constructors

func String(opts ...map[string]interface{}) *FieldSchema {
	f := &FieldSchema{Type: "string", Required: true}
	applyOpts(f, opts)
	return f
}

func Number(opts ...map[string]interface{}) *FieldSchema {
	f := &FieldSchema{Type: "number", Required: true}
	applyOpts(f, opts)
	return f
}

func Bool(opts ...map[string]interface{}) *FieldSchema {
	f := &FieldSchema{Type: "boolean", Required: true}
	applyOpts(f, opts)
	return f
}

func ObjectOf(fields Fields, opts ...map[string]interface{}) *FieldSchema {
	props := make(map[string]*FieldSchema, len(fields))
	for k, v := range fields {
		props[k] = v
	}
	f := &FieldSchema{Type: "object", Required: true, Properties: props}
	applyOpts(f, opts)
	return f
}

func ArrayOf(items *FieldSchema, opts ...map[string]interface{}) *FieldSchema {
	f := &FieldSchema{Type: "array", Required: true, Items: items}
	applyOpts(f, opts)
	return f
}

func Optional(schema *FieldSchema) *FieldSchema {
	s := *schema
	s.Required = false
	return &s
}

func WithDescription(schema *FieldSchema, desc string) *FieldSchema {
	s := *schema
	s.Description = desc
	return &s
}

func applyOpts(f *FieldSchema, opts []map[string]interface{}) {
	if len(opts) == 0 {
		return
	}
	o := opts[0]
	if v, ok := o["required"].(bool); ok {
		f.Required = v
	}
	if v, ok := o["description"].(string); ok {
		f.Description = v
	}
}

// ─── CAPABILITY ───────────────────────────────────────────────────────────────

// Cap defines a backend capability to register with WireBridge.
type Cap struct {
	Name        string  // Human-readable name: "list orders", "create user"
	Handler     string  // Route path: "/api/orders"
	Method      string  // HTTP method: "GET", "POST", etc. Default: "GET"
	Description string
	Tags        []string
	Input       Schema  // Accepted parameters
	Output      Schema  // Shape of the response
}

type capability struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Handler     string  `json:"handler"`
	Method      string  `json:"method"`
	Description string  `json:"description,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Input       Schema  `json:"input,omitempty"`
	Output      Schema  `json:"output"`
	Stack       string  `json:"stack"`
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────

// Config holds bridge connection settings.
type Config struct {
	BridgeURL         string        // Default: http://localhost:7331
	ServiceID         string        // Auto-generated if empty
	ServiceName       string        // Required
	Version           string        // Default: "1.0.0"
	BaseURL           string        // Required: where your Go server listens
	APIKey            string        // Claude API key for LLM synthesis
	HeartbeatInterval time.Duration // Default: 30s
}

func (c *Config) defaults() {
	if c.BridgeURL == "" {
		c.BridgeURL = "http://localhost:7331"
	}
	if c.ServiceID == "" {
		c.ServiceID = fmt.Sprintf("svc-%s", randHex(8))
	}
	if c.Version == "" {
		c.Version = "1.0.0"
	}
	if c.HeartbeatInterval == 0 {
		c.HeartbeatInterval = 30 * time.Second
	}
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

// Client is the WireBridge Go SDK client.
type Client struct {
	config       Config
	capabilities []capability
	mu           sync.Mutex
	registered   bool
	stopHB       chan struct{}
}

// New creates a new WireBridge client.
func New(cfg Config) *Client {
	cfg.defaults()
	return &Client{
		config: cfg,
		stopHB: make(chan struct{}),
	}
}

// Capability registers a backend capability with WireBridge.
// Call this before Register().
func (c *Client) Capability(cap Cap) *Client {
	c.mu.Lock()
	defer c.mu.Unlock()

	method := cap.Method
	if method == "" {
		method = "GET"
	}

	id := fmt.Sprintf("%s.%s", c.config.ServiceID, sanitize(cap.Handler))

	c.capabilities = append(c.capabilities, capability{
		ID:          id,
		Name:        cap.Name,
		Handler:     cap.Handler,
		Method:      method,
		Description: cap.Description,
		Tags:        cap.Tags,
		Input:       cap.Input,
		Output:      cap.Output,
		Stack:       "go",
	})

	return c
}

// Register pushes the service manifest to the WireBridge bridge server.
// It then starts a background heartbeat goroutine to keep the service alive.
func (c *Client) Register() error {
	return c.RegisterWithKey("")
}

// RegisterWithKey registers with an explicit Claude API key (overrides config).
func (c *Client) RegisterWithKey(apiKey string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := apiKey
	if key == "" {
		key = c.config.APIKey
	}
	if key == "" {
		key = os.Getenv("WIREBRIDGE_ANTHROPIC_KEY")
	}
	if key == "" {
		key = os.Getenv("ANTHROPIC_API_KEY")
	}

	manifest := c.buildManifest()
	payload := map[string]interface{}{
		"manifest": manifest,
	}
	if key != "" {
		payload["apiKey"] = key
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("wirebridge: marshal manifest: %w", err)
	}

	resp, err := http.Post(
		c.config.BridgeURL+"/registry/backend",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("wirebridge: register request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("wirebridge: bridge returned %d: %s", resp.StatusCode, string(b))
	}

	c.registered = true
	log.Printf("[WireBridge] ✓ Registered %d capabilities for '%s'",
		len(c.capabilities), c.config.ServiceName)

	go c.heartbeatLoop()
	return nil
}

// MustRegister calls Register and panics on failure. Useful in main().
func (c *Client) MustRegister() {
	if err := c.Register(); err != nil {
		panic(fmt.Sprintf("wirebridge: registration failed: %v", err))
	}
}

// Stop shuts down the heartbeat goroutine gracefully.
func (c *Client) Stop() {
	select {
	case c.stopHB <- struct{}{}:
	default:
	}
}

func (c *Client) heartbeatLoop() {
	ticker := time.NewTicker(c.config.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.sendHeartbeat()
		case <-c.stopHB:
			return
		}
	}
}

func (c *Client) sendHeartbeat() {
	body, _ := json.Marshal(map[string]string{
		"serviceId": c.config.ServiceID,
	})
	resp, err := http.Post(
		c.config.BridgeURL+"/registry/heartbeat",
		"application/json",
		bytes.NewReader(body),
	)
	if err == nil {
		resp.Body.Close()
	}
}

type manifest struct {
	ServiceID    string       `json:"serviceId"`
	ServiceName  string       `json:"serviceName"`
	Version      string       `json:"version"`
	BaseURL      string       `json:"baseUrl"`
	Stack        string       `json:"stack"`
	Capabilities []capability `json:"capabilities"`
	RegisteredAt string       `json:"registeredAt"`
}

func (c *Client) buildManifest() manifest {
	return manifest{
		ServiceID:    c.config.ServiceID,
		ServiceName:  c.config.ServiceName,
		Version:      c.config.Version,
		BaseURL:      c.config.BaseURL,
		Stack:        "go",
		Capabilities: c.capabilities,
		RegisteredAt: time.Now().UTC().Format(time.RFC3339),
	}
}

// ─── GIN INTEGRATION ─────────────────────────────────────────────────────────

// GinRoute is a helper for Gin users — wraps a handler and auto-registers
// the capability. Returns the handler unchanged.
//
// Usage:
//
//	r.GET("/api/orders", bridge.GinRoute(Cap{
//	    Name:   "list orders",
//	    Output: Schema{"orders": ArrayOf(ObjectOf(...))},
//	}, func(c *gin.Context) { ... }))
func (c *Client) GinRoute(cap Cap, handler interface{}) interface{} {
	cap.Handler = cap.Handler // Handler path set by caller
	c.Capability(cap)
	return handler
}

// ─── NET/HTTP MIDDLEWARE ──────────────────────────────────────────────────────

// Middleware returns an http.Handler that registers capabilities and
// automatically calls Register() when the first request comes in.
//
// Usage:
//
//	http.Handle("/", bridge.Middleware(mux))
func (c *Client) Middleware(next http.Handler) http.Handler {
	var once sync.Once
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		once.Do(func() {
			if !c.registered {
				if err := c.Register(); err != nil {
					log.Printf("[WireBridge] Auto-registration failed: %v", err)
				}
			}
		})
		next.ServeHTTP(w, r)
	})
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

func randHex(n int) string {
	const chars = "abcdef0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func sanitize(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			out = append(out, c)
		} else if c == '/' || c == '-' || c == '_' {
			out = append(out, '-')
		}
	}
	return string(out)
}
