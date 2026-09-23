package com.picturecard.learning;

import java.net.URI;
import java.net.URLEncoder;
import java.math.BigInteger;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Reads public installation-page metadata as text; never executes remote scripts. */
final class UpdatePage {
    private UpdatePage() {}

    static String version(String html, String appKey) {
        String version = field(html, "aVersion");
        if (!appKey.equals(field(html, "agKey")) || !"android".equals(field(html, "aType"))
                || version == null || version.length() > 40 || !version.matches("[0-9]+(?:\\.[0-9]+)*")) {
            throw new IllegalArgumentException("Public update metadata unavailable");
        }
        return version;
    }

    static URI downloadUrl(String html, String appKey, long now) throws Exception {
        version(html, appKey);
        String build = field(html, "aKey"), token = field(html, "installToken"), auth = field(html, "authcode"), time = field(html, "timeSign");
        String price = field(html, "downloadPayMoney");
        if (build == null || !build.matches("[a-f0-9]{32}") || token == null || !token.matches("[\\x21-\\x7e]{10,512}")
                || auth == null || !auth.matches("[0-9]{1,15}") || time == null || !time.matches("[a-fA-F0-9]{24}")
                || !"0".equals(price) || !"false".equals(field(html, "isTeamInstall"))) {
            throw new IllegalArgumentException("PUBLIC_DOWNLOAD_UNAVAILABLE");
        }
        long random = now % 1000000;
        String finalCode = Integer.toString((int) Long.parseLong(auth) ^ (int) random) + String.format(Locale.ROOT, "%06d", random);
        StringBuilder decoded = new StringBuilder();
        for (int index = 0; index < time.length(); index += 2) {
            int value = Character.toLowerCase((char) Integer.parseInt(time.substring(index, index + 2), 16));
            decoded.append(String.format(Locale.ROOT, "%02x", value));
        }
        String query = "time=" + now + "&finalCode=" + finalCode + "&timeSign=" + decoded + "&installToken=" + URLEncoder.encode(token, "UTF-8");
        String signature = field(html, "sig");
        if (signature != null && !signature.isEmpty()) query += "&sig=" + URLEncoder.encode(signature, "UTF-8");
        return new URI("https://www.pgyer.com/app/install/" + build + "?" + query);
    }

    static boolean allowedDownload(URI uri) {
        String host = uri.getHost();
        return "https".equalsIgnoreCase(uri.getScheme()) && uri.getUserInfo() == null && uri.getFragment() == null
                && (uri.getPort() == -1 || uri.getPort() == 443) && host != null
                && ("www.pgyer.com".equalsIgnoreCase(host) || host.toLowerCase(Locale.ROOT).endsWith(".pgyer.com"));
    }

    static int compareVersions(String left, String right) {
        if (left == null || right == null || left.length() > 40 || right.length() > 40
                || !left.matches("[0-9]+(?:\\.[0-9]+)*") || !right.matches("[0-9]+(?:\\.[0-9]+)*")) throw new IllegalArgumentException("INVALID_VERSION");
        String[] a = left.split("\\."), b = right.split("\\.");
        for (int index = 0; index < Math.max(a.length, b.length); index++) {
            int difference = new BigInteger(index < a.length ? a[index] : "0").compareTo(new BigInteger(index < b.length ? b[index] : "0"));
            if (difference != 0) return difference;
        }
        return 0;
    }

    private static String field(String html, String name) {
        Matcher match = Pattern.compile("\\b" + name + "\\s*=\\s*['\"]([^'\"]{0,512})['\"]").matcher(html);
        return match.find() ? match.group(1) : null;
    }
}
