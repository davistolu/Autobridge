<?php

namespace WireBridge\Facades;

use Illuminate\Support\Facades\Facade;

/**
 * WireBridge Facade
 *
 * Provides static access to the BridgeClient singleton.
 *
 * Usage:
 *   use WireBridge\Facades\Bridge;
 *
 *   Bridge::capability('list users', [...])
 *        ->capability('create user', [...])
 *        ->register();
 */
class Bridge extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'wirebridge';
    }
}
