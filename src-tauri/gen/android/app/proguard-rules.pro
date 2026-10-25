# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# Rust invokes these on the real Activity via JNI; do not rename them in release builds.
-keepclassmembers class com.kd9taw.tempo.MainActivity {
    public java.lang.String[] nexusDataFolderRoots();
    public void showNexusDataFolder(long, java.lang.String);
    public void cancelNexusDataFolder(long);
    private native void nexusDataFolderResult(long, java.lang.String, java.lang.String);
}