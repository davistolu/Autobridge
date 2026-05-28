<?php

namespace WireBridge;

/**
 * WireBridge Laravel SDK
 *
 * Registers your Laravel backend's capabilities with the WireBridge
 * bridge server so the frontend can wire to them automatically.
 *
 * Usage:
 *   use WireBridge\BridgeClient;
 *
 *   $bridge = new BridgeClient([
 *       'service_name' => 'my-laravel-api',
 *       'base_url'     => 'http://localhost:8000',
 *   ]);
 *
 *   $bridge->capability('list users', [
 *       'handler' => '/api/users',
 *       'method'  => 'GET',
 *       'tags'    => ['users', 'read'],
 *       'output'  => [
 *           'users' => Schema::arrayOf(Schema::objectOf([
 *               'id'    => Schema::string(),
 *               'name'  => Schema::string(),
 *               'email' => Schema::string(),
 *           ])),
 *       ],
 *   ])->register();
 */
class BridgeClient
{
    protected array $config;
    protected array $capabilities = [];
    protected bool $registered = false;

    public function __construct(array $config = [])
    {
        $this->config = array_merge([
            'bridge_url'         => env('WIREBRIDGE_BRIDGE_URL', 'http://localhost:7331'),
            'service_id'         => null,
            'service_name'       => env('APP_NAME', 'laravel-service'),
            'version'            => '1.0.0',
            'base_url'           => env('APP_URL', 'http://localhost:8000'),
            'api_key'            => env('WIREBRIDGE_ANTHROPIC_KEY', env('ANTHROPIC_API_KEY')),
            'heartbeat_interval' => 30,
            'stack'              => 'php-laravel',
        ], $config);

        if (empty($this->config['service_id'])) {
            $this->config['service_id'] = 'svc-' . substr(md5(uniqid()), 0, 8);
        }
    }

    /**
     * Register a backend capability — fluent, chainable.
     *
     * @param string $name    Human-readable name: "list users", "create order"
     * @param array  $options Handler, method, tags, input, output schemas
     */
    public function capability(string $name, array $options): static
    {
        $handler = $options['handler'] ?? '/api/' . str_replace(' ', '-', strtolower($name));
        $id      = $this->config['service_id'] . '.' . preg_replace('/[^a-z0-9]/', '-', $handler);

        $this->capabilities[] = [
            'id'          => $id,
            'name'        => $name,
            'handler'     => $handler,
            'method'      => strtoupper($options['method'] ?? 'GET'),
            'description' => $options['description'] ?? '',
            'tags'        => $options['tags'] ?? [],
            'input'       => $options['input'] ?? [],
            'output'      => $options['output'] ?? [],
            'stack'       => 'php-laravel',
        ];

        return $this;
    }

    /**
     * Push the service manifest to the WireBridge bridge server
     * and start the background heartbeat.
     */
    public function register(?string $apiKey = null): bool
    {
        $key      = $apiKey ?? $this->config['api_key'];
        $manifest = $this->buildManifest();
        $payload  = ['manifest' => $manifest];

        if ($key) {
            $payload['apiKey'] = $key;
        }

        try {
            $ch = curl_init($this->config['bridge_url'] . '/registry/backend');
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => json_encode($payload),
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 10,
                CURLOPT_CONNECTTIMEOUT => 5,
            ]);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode >= 400) {
                error_log("[WireBridge] Registration failed: HTTP {$httpCode} — {$response}");
                return false;
            }

            $this->registered = true;
            error_log("[WireBridge] ✓ Registered " . count($this->capabilities) . " capabilities for '{$this->config['service_name']}'");

            $this->startHeartbeat();
            return true;

        } catch (\Throwable $e) {
            error_log("[WireBridge] Registration error: " . $e->getMessage());
            return false;
        }
    }

    protected function buildManifest(): array
    {
        return [
            'serviceId'    => $this->config['service_id'],
            'serviceName'  => $this->config['service_name'],
            'version'      => $this->config['version'],
            'baseUrl'      => $this->config['base_url'],
            'stack'        => $this->config['stack'],
            'capabilities' => $this->capabilities,
            'registeredAt' => gmdate('Y-m-d\TH:i:s\Z'),
        ];
    }

    /**
     * Heartbeat runs in a separate process via a dispatch-to-queue approach.
     * In Laravel, this is done via a recurring job. See HeartbeatJob.
     * For simple setups, we fire a one-off cURL in a register_shutdown_function.
     */
    protected function startHeartbeat(): void
    {
        $bridgeUrl = $this->config['bridge_url'];
        $serviceId = $this->config['service_id'];

        // Schedule via shutdown function (works without a queue)
        // For production, use WireBridgeHeartbeatJob (see docs)
        register_shutdown_function(function () use ($bridgeUrl, $serviceId) {
            $this->sendHeartbeat($bridgeUrl, $serviceId);
        });
    }

    protected function sendHeartbeat(string $bridgeUrl, string $serviceId): void
    {
        try {
            $ch = curl_init($bridgeUrl . '/registry/heartbeat');
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => json_encode(['serviceId' => $serviceId]),
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 3,
            ]);
            curl_exec($ch);
            curl_close($ch);
        } catch (\Throwable) {
            // Heartbeat failures are silent
        }
    }
}
