plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

android {
    namespace = "org.tilecast.player"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.tilecast.player"
        minSdk = 23
        targetSdk = 35
        // Keep versionCode monotonic for signed GitHub releases.
        versionCode = 23
        versionName = "0.13.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
		buildConfigField("long", "MEDIA_CACHE_BYTES", "${providers.gradleProperty("TILECAST_PLAYER_CACHE_BYTES").orElse("8589934592").get()}L")
		buildConfigField("long", "MINIMUM_FREE_BYTES", "${providers.gradleProperty("TILECAST_PLAYER_MINIMUM_FREE_BYTES").orElse("1073741824").get()}L")
		buildConfigField("long", "AUTOMATIC_VIDEO_THRESHOLD_BYTES", "${providers.gradleProperty("TILECAST_PLAYER_AUTOMATIC_VIDEO_THRESHOLD_BYTES").orElse("268435456").get()}L")
		buildConfigField("int", "CONCURRENT_DOWNLOADS", providers.gradleProperty("TILECAST_PLAYER_CONCURRENT_DOWNLOADS").orElse("2").get())
    }

    val releaseKeystore = providers.environmentVariable("TILECAST_ANDROID_KEYSTORE_PATH")
    val releaseStorePassword = providers.environmentVariable("TILECAST_ANDROID_KEYSTORE_PASSWORD")
    val releaseAlias = providers.environmentVariable("TILECAST_ANDROID_KEY_ALIAS")
    val releaseKeyPassword = providers.environmentVariable("TILECAST_ANDROID_KEY_PASSWORD")
    signingConfigs {
        if (releaseKeystore.isPresent && releaseStorePassword.isPresent && releaseAlias.isPresent && releaseKeyPassword.isPresent) {
            create("production") {
                storeFile = file(releaseKeystore.get())
                storePassword = releaseStorePassword.get()
                keyAlias = releaseAlias.get()
                keyPassword = releaseKeyPassword.get()
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("production")
        }
    }
    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging.resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    testOptions.unitTests.isIncludeAndroidResources = true
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.04.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.room:room-runtime:2.7.2")
    implementation("androidx.room:room-ktx:2.7.2")
    ksp("androidx.room:room-compiler:2.7.2")
    implementation("androidx.work:work-runtime-ktx:2.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.media3:media3-exoplayer:1.7.1")
    implementation("androidx.media3:media3-ui:1.7.1")
    implementation("androidx.media3:media3-datasource-okhttp:1.7.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("com.google.zxing:core:3.5.3")
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("androidx.room:room-testing:2.7.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
