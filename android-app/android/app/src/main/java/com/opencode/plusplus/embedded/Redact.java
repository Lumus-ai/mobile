package com.opencode.plusplus.embedded;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Single choke point for secret scrubbing in diagnostics. Two layers:
 * 1) registered concrete secrets (the per-launch server password etc.) are
 *    replaced verbatim — the working handshake is untouched, only displayed
 *    / copied text is scrubbed;
 * 2) pattern pass for password/token/key/cookie-shaped fields in JSON,
 *    key=value pairs, and Basic/Bearer auth headers.
 * Pure Java (no android imports) so the fixture test can run anywhere.
 */
final class Redact {
    private static final Set<String> SECRETS = ConcurrentHashMap.newKeySet();

    private static final Pattern JSON_FIELD = Pattern.compile(
            "(\\\"(?:password|token|key|secret|cookie|authorization|access_token|refresh_token|api_key)\\\"\\s*:\\s*\\\")[^\\\"]*(\\\")",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern KV_FIELD = Pattern.compile(
            "\\b(password|token|key|secret|cookie|authorization|access_token|refresh_token|api_key)(=)[^\\s&,\"}]+",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern BASIC = Pattern.compile(
            "(Basic\\s+)[A-Za-z0-9+/=]{8,}", Pattern.CASE_INSENSITIVE);
    private static final Pattern BEARER = Pattern.compile(
            "(Bearer\\s+)[A-Za-z0-9._~+/=-]{8,}", Pattern.CASE_INSENSITIVE);

    private Redact() {}

    /** Registers a concrete secret value to scrub verbatim from all diagnostics. */
    static void registerSecret(String s) {
        if (s != null && s.length() >= 8) SECRETS.add(s);
    }

    static String apply(String text) {
        if (text == null) return null;
        String out = text;
        for (String s : SECRETS) out = out.replace(s, "[redacted]");
        out = JSON_FIELD.matcher(out).replaceAll("$1[redacted]$2");
        out = KV_FIELD.matcher(out).replaceAll("$1$2[redacted]");
        out = BASIC.matcher(out).replaceAll("$1[redacted]");
        out = BEARER.matcher(out).replaceAll("$1[redacted]");
        return out;
    }
}
