<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use WireBridge\BridgeClient;
use WireBridge\Schema;

/**
 * Example: Laravel AppServiceProvider with WireBridge
 *
 * Register capabilities in boot() so they're available after
 * all service providers have loaded.
 */
class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        $this->registerWithWireBridge();
    }

    private function registerWithWireBridge(): void
    {
        // Don't register during artisan commands (migrations, queue workers, etc.)
        if ($this->app->runningInConsole()) {
            return;
        }

        $bridge = new BridgeClient([
            'service_name' => 'ecommerce-api',
            'base_url'     => config('app.url'),
            // 'api_key'   => env('ANTHROPIC_API_KEY'), // or set in .env
        ]);

        $bridge
            // ── Users ──────────────────────────────────────────────────────
            ->capability('list users', [
                'handler'     => '/api/users',
                'method'      => 'GET',
                'tags'        => ['users', 'read', 'list'],
                'description' => 'Returns paginated list of all users',
                'input'       => [
                    'page'     => Schema::optional(Schema::number(['description' => 'Page number'])),
                    'per_page' => Schema::optional(Schema::number()),
                    'search'   => Schema::optional(Schema::string()),
                ],
                'output'      => [
                    'data' => Schema::arrayOf(Schema::objectOf([
                        'id'         => Schema::number(),
                        'name'       => Schema::string(),
                        'email'      => Schema::string(),
                        'role'       => Schema::enum(['admin', 'user', 'guest']),
                        'created_at' => Schema::string(['description' => 'ISO 8601 timestamp']),
                    ])),
                    'meta' => Schema::objectOf([
                        'total'        => Schema::number(),
                        'current_page' => Schema::number(),
                        'last_page'    => Schema::number(),
                    ]),
                ],
            ])

            ->capability('get user', [
                'handler' => '/api/users/{id}',
                'method'  => 'GET',
                'tags'    => ['users', 'read', 'detail'],
                'input'   => ['id' => Schema::number()],
                'output'  => [
                    'user' => Schema::objectOf([
                        'id'         => Schema::number(),
                        'name'       => Schema::string(),
                        'email'      => Schema::string(),
                        'role'       => Schema::string(),
                        'created_at' => Schema::string(),
                    ]),
                ],
            ])

            ->capability('create user', [
                'handler' => '/api/users',
                'method'  => 'POST',
                'tags'    => ['users', 'create', 'write'],
                'input'   => [
                    'name'     => Schema::string(),
                    'email'    => Schema::string(),
                    'password' => Schema::string(),
                    'role'     => Schema::optional(Schema::enum(['admin', 'user', 'guest'])),
                ],
                'output'  => [
                    'user'    => Schema::objectOf(['id' => Schema::number(), 'name' => Schema::string(), 'email' => Schema::string()]),
                    'message' => Schema::string(),
                ],
            ])

            // ── Products ───────────────────────────────────────────────────
            ->capability('list products', [
                'handler' => '/api/products',
                'method'  => 'GET',
                'tags'    => ['products', 'catalog', 'read', 'list'],
                'output'  => [
                    'data' => Schema::arrayOf(Schema::objectOf([
                        'id'          => Schema::number(),
                        'name'        => Schema::string(),
                        'price'       => Schema::number(['description' => 'Price in cents']),
                        'stock'       => Schema::number(),
                        'category'    => Schema::string(),
                        'description' => Schema::optional(Schema::string()),
                        'image_url'   => Schema::optional(Schema::string()),
                    ])),
                    'meta' => Schema::objectOf(['total' => Schema::number()]),
                ],
            ])

            ->capability('get product', [
                'handler' => '/api/products/{id}',
                'method'  => 'GET',
                'tags'    => ['products', 'catalog', 'read', 'detail'],
                'input'   => ['id' => Schema::number()],
                'output'  => [
                    'product' => Schema::objectOf([
                        'id'          => Schema::number(),
                        'name'        => Schema::string(),
                        'price'       => Schema::number(),
                        'stock'       => Schema::number(),
                        'category'    => Schema::string(),
                        'description' => Schema::optional(Schema::string()),
                        'images'      => Schema::arrayOf(Schema::string()),
                    ]),
                ],
            ])

            // ── Orders ─────────────────────────────────────────────────────
            ->capability('list orders', [
                'handler' => '/api/orders',
                'method'  => 'GET',
                'tags'    => ['orders', 'read', 'list', 'transactions'],
                'input'   => [
                    'user_id' => Schema::optional(Schema::number()),
                    'status'  => Schema::optional(Schema::enum(['pending', 'paid', 'shipped', 'delivered', 'cancelled'])),
                ],
                'output'  => [
                    'data' => Schema::arrayOf(Schema::objectOf([
                        'id'         => Schema::number(),
                        'user_id'    => Schema::number(),
                        'total'      => Schema::number(),
                        'status'     => Schema::string(),
                        'created_at' => Schema::string(),
                    ])),
                    'meta' => Schema::objectOf(['total' => Schema::number()]),
                ],
            ])

            ->capability('create order', [
                'handler'     => '/api/orders',
                'method'      => 'POST',
                'tags'        => ['orders', 'create', 'write', 'checkout'],
                'description' => 'Place a new order for the authenticated user',
                'input'       => [
                    'items' => Schema::arrayOf(Schema::objectOf([
                        'product_id' => Schema::number(),
                        'quantity'   => Schema::number(),
                    ])),
                    'shipping_address' => Schema::objectOf([
                        'line1'   => Schema::string(),
                        'city'    => Schema::string(),
                        'country' => Schema::string(),
                    ]),
                ],
                'output'      => [
                    'order'   => Schema::objectOf([
                        'id'     => Schema::number(),
                        'total'  => Schema::number(),
                        'status' => Schema::string(),
                    ]),
                    'message' => Schema::string(),
                ],
            ])

            // ── Auth ───────────────────────────────────────────────────────
            ->capability('login', [
                'handler' => '/api/auth/login',
                'method'  => 'POST',
                'tags'    => ['auth', 'login', 'session'],
                'input'   => [
                    'email'    => Schema::string(),
                    'password' => Schema::string(),
                ],
                'output'  => [
                    'token' => Schema::string(['description' => 'Bearer token']),
                    'user'  => Schema::objectOf(['id' => Schema::number(), 'name' => Schema::string()]),
                ],
            ])

            ->capability('logout', [
                'handler' => '/api/auth/logout',
                'method'  => 'POST',
                'tags'    => ['auth', 'logout', 'session'],
                'output'  => ['message' => Schema::string()],
            ])

            ->register();
    }
}
