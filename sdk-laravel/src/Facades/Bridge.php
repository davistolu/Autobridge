<?php

namespace AutoBridge\Facades;

use Illuminate\Support\Facades\Facade;

/**
 * AutoBridge Facade
 *
 * Provides static access to the BridgeClient singleton.
 *
 * Usage:
 *   use AutoBridge\Facades\Bridge;
 *
 *   Bridge::capability('list users', [...])
 *        ->capability('create user', [...])
 *        ->register();
 */
class Bridge extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'autobridge';
    }
}
