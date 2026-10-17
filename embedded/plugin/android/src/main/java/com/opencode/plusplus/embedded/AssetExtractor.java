package com.opencode.plusplus.embedded;

import android.content.res.AssetManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Recursive copy of assets/nodejs-project into the app files dir. */
final class AssetExtractor {
    static void extract(AssetManager am, String assetPath, File outDir) throws IOException {
        String[] children = am.list(assetPath);
        if (children == null || children.length == 0) {
            // A file, or an empty folder (assets drop empty dirs).
            outDir.getParentFile().mkdirs();
            try (InputStream in = am.open(assetPath);
                 FileOutputStream out = new FileOutputStream(outDir)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            }
            outDir.setExecutable(true, true);
            return;
        }
        outDir.mkdirs();
        for (String child : children) {
            extract(am, assetPath + "/" + child, new File(outDir, child));
        }
    }
}
