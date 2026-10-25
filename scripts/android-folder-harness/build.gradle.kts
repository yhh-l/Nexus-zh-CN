// Cloud test harness for the actual product picker, not a substitute Tauri/Android app.
plugins {
    id("com.android.library") version "8.11.0"
    id("org.jetbrains.kotlin.android") version "1.9.25"
}

val repository = rootDir.resolve("../..").canonicalFile
val nativeApp = repository.resolve("src-tauri/gen/android/app/src/main")

android {
    namespace = "com.kd9taw.tempo"
    compileSdk = 36
    defaultConfig { minSdk = 35 }
    sourceSets.getByName("main") {
        java.setSrcDirs(emptyList<String>())
        res.setSrcDirs(listOf(nativeApp.resolve("res")))
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

kotlin.sourceSets.getByName("main").kotlin.apply {
    setSrcDirs(listOf(nativeApp.resolve("java/com/kd9taw/tempo")))
    include("NexusDataFolderPicker.kt")
}

dependencies {
    // Same theme resources as the actual host; no TauriActivity stub is supplied.
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
