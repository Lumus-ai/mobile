package com.opencode.plusplus.embedded;

/** JNI bridge into the nodejs-mobile runtime (libnode.so + libnodebridge.so). */
public final class NodeRuntime {
    static {
        System.loadLibrary("node");
        System.loadLibrary("nodebridge");
    }

    private NodeRuntime() {}

    /** Blocking: runs the node process. Call on a dedicated thread. */
    public static native int startNodeWithArguments(String[] args);
}
