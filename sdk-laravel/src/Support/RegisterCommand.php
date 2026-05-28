<?php

namespace WireBridge\Support;

use Illuminate\Console\Command;
use WireBridge\BridgeClient;

/**
 * Artisan command for re-registering with WireBridge.
 * Useful in deployments, CI/CD pipelines, or as a scheduled task.
 *
 * Usage:
 *   php artisan wirebridge:register
 *
 * Schedule in app/Console/Kernel.php:
 *   $schedule->command('wirebridge:register')->everyThirtySeconds();
 */
class RegisterCommand extends Command
{
    protected $signature   = 'wirebridge:register {--force : Force re-registration even if already registered}';
    protected $description = 'Register this Laravel service with the WireBridge bridge server';

    public function handle(BridgeClient $bridge): int
    {
        $this->info('[WireBridge] Registering with bridge server...');

        $success = $bridge->register();

        if ($success) {
            $this->info('[WireBridge] ✓ Registration successful');
            return Command::SUCCESS;
        } else {
            $this->error('[WireBridge] ✗ Registration failed — is the bridge server running?');
            return Command::FAILURE;
        }
    }
}
