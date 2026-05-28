<?php

namespace WireBridge;

/**
 * Schema helpers for describing capability input/output shapes.
 *
 * These produce the neutral WireBridge manifest format that the
 * bridge uses for convention matching and LLM synthesis.
 *
 * Usage:
 *   use WireBridge\Schema;
 *
 *   Schema::string()
 *   Schema::number(['description' => 'Price in cents'])
 *   Schema::arrayOf(Schema::objectOf(['id' => Schema::string(), 'name' => Schema::string()]))
 *   Schema::optional(Schema::string())
 */
class Schema
{
    public static function string(array $opts = []): array
    {
        return array_merge(['type' => 'string', 'required' => true], $opts);
    }

    public static function number(array $opts = []): array
    {
        return array_merge(['type' => 'number', 'required' => true], $opts);
    }

    public static function boolean(array $opts = []): array
    {
        return array_merge(['type' => 'boolean', 'required' => true], $opts);
    }

    public static function objectOf(array $properties, array $opts = []): array
    {
        return array_merge(['type' => 'object', 'required' => true, 'properties' => $properties], $opts);
    }

    public static function arrayOf(array $items, array $opts = []): array
    {
        return array_merge(['type' => 'array', 'required' => true, 'items' => $items], $opts);
    }

    public static function optional(array $schema): array
    {
        return array_merge($schema, ['required' => false]);
    }

    public static function withDescription(array $schema, string $description): array
    {
        return array_merge($schema, ['description' => $description]);
    }

    public static function any(array $opts = []): array
    {
        return array_merge(['type' => 'any', 'required' => true], $opts);
    }

    public static function enum(array $values, array $opts = []): array
    {
        return array_merge(['type' => 'string', 'required' => true, 'enum' => $values], $opts);
    }
}
