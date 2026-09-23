package com.picturecard.learning;
import java.nio.file.Files;
import java.nio.file.Path;
public final class UpdatePageCheck {
    public static void main(String[] args) throws Exception {
        String html = Files.readString(Path.of(args[0]));
        String appKey = args[1];
        if (!"1.7".equals(UpdatePage.version(html, appKey))) throw new AssertionError("Real public metadata");
        if (!"1.12".equals(UpdatePage.version(html.replace("aVersion = '1.7'", "aVersion = '1.12'"), appKey))) throw new AssertionError("New release metadata");
        int rejected = 0;
        for (String page : new String[]{html.replace(appKey, "other-app"), html.replace("aType = 'android'", "aType = 'ios'"), html.replace("aVersion = '1.7'", "aVersion = '<script>'"), "<html>unavailable</html>"}) {
            try { UpdatePage.version(page, appKey); } catch (IllegalArgumentException expected) { rejected++; }
        }
        if (rejected != 4) throw new AssertionError("Invalid metadata must be unavailable");
        System.out.println("Native public metadata: real page, next version and 4 invalid cases passed.");
    }
}
