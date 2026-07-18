import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")

if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

val requiredSigningProperties = listOf("keyAlias", "keyPassword", "storeFile", "storePassword")
val releaseSigningConfigured = keystorePropertiesFile.exists() &&
    requiredSigningProperties.all { !keystoreProperties.getProperty(it).isNullOrBlank() }

android {
    namespace = "com.vitalink.frontend"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.vitalink.frontend"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                val keyAlias = keystoreProperties.getProperty("keyAlias")
                val keyPassword = keystoreProperties.getProperty("keyPassword")
                val storeFilePath = keystoreProperties.getProperty("storeFile")
                val storePassword = keystoreProperties.getProperty("storePassword")

                if (!storeFilePath.isNullOrBlank()) {
                    storeFile = file(storeFilePath)
                }
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
                this.storePassword = storePassword
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
        }
    }
}

tasks.configureEach {
    val isReleaseArtifactTask =
        (name.startsWith("assemble") || name.startsWith("bundle")) && name.endsWith("Release")
    if (isReleaseArtifactTask) {
        doFirst {
            check(releaseSigningConfigured) {
                "Release signing requires frontend/android/key.properties with: ${requiredSigningProperties.joinToString()}"
            }
        }
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
}

flutter {
    source = "../.."
}
