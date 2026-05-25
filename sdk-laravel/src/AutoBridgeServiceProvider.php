<?php

namespace AutoBridge;

use Illuminate\Support\ServiceProvider;

/**
 * AutoBridge Service Provider
 *
 * Registers the AutoBridge singleton, loads config, and
 * triggers registration on app boot.
 *
 * Add to config/app.php providers array:
 *   AutoBridge\AutoBridgeServiceProvider::class,
 *
 * Or use package auto-discovery (composer.json extra.laravel.providers).
 */
class AutoBridgeServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/autobridge.php', 'autobridge');

        $this->app->singleton(BridgeClient::class, function ($app) {
            $config = $app['config']['autobridge'];
            return new BridgeClient($config);
        });

        // Alias for facade
        $this->app->alias(BridgeClient::class, 'autobridge');
    }

    public function boot(): void
    {
        // Publish config
        $this->publishes([
            __DIR__ . '/../config/autobridge.php' => config_path('autobridge.php'),
        ], 'autobridge-config');

        // Auto-register on boot if configured to do so
        if (config('autobridge.auto_register', true) && !$this->app->runningInConsole()) {
            $this->app->booted(function () {
                try {
                    $this->app->make(BridgeClient::class)->register();
                } catch (\Throwable $e) {
                    // Don't break the app if AutoBridge is unavailable
                    \Log::warning('[AutoBridge] Auto-registration failed: ' . $e->getMessage());
                }
            });
        }
    }
}
