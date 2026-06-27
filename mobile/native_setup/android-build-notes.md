# Android build configuration notes

Apply these after `flutter create .` (which generates `android/`).

## 1. Minimum SDK
`flutter_webrtc` and `flutter_callkit_incoming` require API 23+.

In `android/app/build.gradle` (or `build.gradle.kts`), set:

```gradle
android {
    compileSdk = 34            // or flutter.compileSdkVersion

    defaultConfig {
        minSdk = 23            // REQUIRED (WebRTC + CallKit)
        targetSdk = 34
    }
}
```

## 2. Firebase (FCM) — Google services plugin
Add the plugin so `google-services.json` is processed.

`android/build.gradle` (project level) — in `dependencies` of `buildscript`
(only if using the legacy plugin block):
```gradle
classpath 'com.google.gms:google-services:4.4.2'
```

`android/app/build.gradle` — at the very bottom (legacy) or in the `plugins {}`
block (new):
```gradle
// legacy:
apply plugin: 'com.google.gms.google-services'

// or new plugins DSL (settings.gradle pluginManagement):
// id "com.google.gms.google-services" version "4.4.2" apply false
```

Place your Firebase Android config at:
```
android/app/google-services.json
```
(Download it from the Firebase console → Project settings → Your apps → Android.)

## 3. Java/Kotlin desugaring (if the build complains)
flutter_callkit_incoming may need core library desugaring:
```gradle
android {
    compileOptions {
        coreLibraryDesugaringEnabled true
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
}
dependencies {
    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.0.4'
}
```

## 4. Proguard / R8
If you enable minification for release, keep WebRTC + CallKit classes (the
plugins ship consumer rules, so usually nothing extra is needed).
