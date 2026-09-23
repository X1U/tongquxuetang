package com.picturecard.learning;

import java.util.Set;

/** Package identity checks run before sharing an APK with the system installer. */
final class UpdateInstallPolicy {
    private UpdateInstallPolicy() {}
    static void requireUpgrade(String installedPackage, long installedCode, Set<String> installedSigners,
                               String candidatePackage, long candidateCode, Set<String> candidateSigners,
                               String candidateVersion, String expectedVersion) {
        if (installedPackage == null || !installedPackage.equals(candidatePackage)) throw new IllegalArgumentException("APK_PACKAGE");
        if (candidateCode <= installedCode || candidateVersion == null || candidateVersion.length() > 40 || !candidateVersion.matches("[0-9]+(?:\\.[0-9]+)*")
                || (expectedVersion != null && !expectedVersion.equals(candidateVersion))) throw new IllegalArgumentException("APK_VERSION");
        if (installedSigners == null || installedSigners.isEmpty() || !installedSigners.equals(candidateSigners)) throw new IllegalArgumentException("APK_SIGNATURE");
    }
}
