<?php

namespace WireBridge;

use Illuminate\Support\ServiceProvider;

/**
 * WireBridge Service Provider
 *
 * Registers the WireBridge singleton, loads config, and
 * triggers registration on app boot.
 *
 * Add to config/app.php providers array:
 *   WireBridge\WireBridgeServiceProvider::class,
 *
 * Or use package auto-discovery (composer.json extra.laravel.providers).
 */
class WireBridgeServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/wirebridge.php', 'wirebridge');

        $this->app->singleton(BridgeClient::class, function ($app) {
            $config = $app['config']['wirebridge'];
            return new BridgeClient($config);
        });

        // Alias for facade
        $this->app->alias(BridgeClient::class, 'wirebridge');
    }

    public function boot(): void
    {
        // Publish config
        $this->publishes([
            __DIR__ . '/../config/wirebridge.php' => config_path('wirebridge.php'),
        ], 'wirebridge-config');

        // Auto-register on boot if configured to do so
        if (config('wirebridge.auto_register', true) && !$this->app->runningInConsole()) {
            $this->app->booted(function () {
                try {
                    $this->app->make(BridgeClient::class)->register();
                } catch (\Throwable $e) {
                    // Don't break the app if WireBridge is unavailable
                    \Log::warning('[WireBridge] Auto-registration failed: ' . $e->getMessage());
                }
            });
        }
    }
}
