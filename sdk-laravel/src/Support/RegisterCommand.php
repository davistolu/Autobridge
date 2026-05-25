<?php

namespace AutoBridge\Support;

use Illuminate\Console\Command;
use AutoBridge\BridgeClient;

/**
 * Artisan command for re-registering with AutoBridge.
 * Useful in deployments, CI/CD pipelines, or as a scheduled task.
 *
 * Usage:
 *   php artisan autobridge:register
 *
 * Schedule in app/Console/Kernel.php:
 *   $schedule->command('autobridge:register')->everyThirtySeconds();
 */
class RegisterCommand extends Command
{
    protected $signature   = 'autobridge:register {--force : Force re-registration even if already registered}';
    protected $description = 'Register this Laravel service with the AutoBridge bridge server';

    public function handle(BridgeClient $bridge): int
    {
        $this->info('[AutoBridge] Registering with bridge server...');

        $success = $bridge->register();

        if ($success) {
            $this->info('[AutoBridge] ✓ Registration successful');
            return Command::SUCCESS;
        } else {
            $this->error('[AutoBridge] ✗ Registration failed — is the bridge server running?');
            return Command::FAILURE;
        }
    }
}
