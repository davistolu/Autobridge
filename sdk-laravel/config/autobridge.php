<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Bridge Server URL
    |--------------------------------------------------------------------------
    | The URL where the WireBridge core server is running.
    | Override with WIREBRIDGE_BRIDGE_URL environment variable.
    */
    'bridge_url' => env('WIREBRIDGE_BRIDGE_URL', 'http://localhost:7331'),

    /*
    |--------------------------------------------------------------------------
    | Service Identity
    |--------------------------------------------------------------------------
    | How this service identifies itself to the bridge. service_id is
    | auto-generated if not set — set it explicitly in production so
    | contracts survive restarts.
    */
    'service_id'   => env('WIREBRIDGE_SERVICE_ID'),
    'service_name' => env('WIREBRIDGE_SERVICE_NAME', env('APP_NAME', 'laravel-service')),
    'version'      => env('WIREBRIDGE_VERSION', '1.0.0'),
    'base_url'     => env('APP_URL', 'http://localhost:8000'),
    'stack'        => 'php-laravel',

    /*
    |--------------------------------------------------------------------------
    | Claude API Key
    |--------------------------------------------------------------------------
    | Used for LLM synthesis when convention matching fails.
    | Resolved in order: this value → WIREBRIDGE_ANTHROPIC_KEY → ANTHROPIC_API_KEY
    */
    'api_key' => env('WIREBRIDGE_ANTHROPIC_KEY', env('ANTHROPIC_API_KEY')),

    /*
    |--------------------------------------------------------------------------
    | Auto-Registration
    |--------------------------------------------------------------------------
    | When true, the service provider automatically calls register() on boot.
    | Set to false if you want to control registration timing manually
    | (e.g. in an AppServiceProvider or via artisan command).
    */
    'auto_register' => env('WIREBRIDGE_AUTO_REGISTER', true),

    /*
    |--------------------------------------------------------------------------
    | Heartbeat Interval
    |--------------------------------------------------------------------------
    | How often (in seconds) to notify the bridge server this service is alive.
    | Set lower for faster offline detection; higher for less network chatter.
    */
    'heartbeat_interval' => env('WIREBRIDGE_HEARTBEAT_INTERVAL', 30),

];
