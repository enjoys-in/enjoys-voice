allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    // Some Flutter plugins (e.g. flutter_webrtc 0.12.x) hard-code an old
    // compileSdk (31) whose AndroidX dependencies (androidx.fragment,
    // androidx.window, ...) now require compileSdk 34+. Force any Android
    // subproject still below 34 up to 36 so the AAR-metadata check passes.
    // Registered before evaluationDependsOn so it is in place before evaluation.
    afterEvaluate {
        val androidExt = extensions.findByName("android")
        if (androidExt != null) {
            runCatching {
                val getter = androidExt.javaClass.methods.firstOrNull {
                    it.name == "getCompileSdkVersion" && it.parameterCount == 0
                }
                val current = (getter?.invoke(androidExt) as? String)
                    ?.removePrefix("android-")?.toIntOrNull()
                if (current == null || current < 34) {
                    androidExt.javaClass.methods.firstOrNull {
                        it.name == "compileSdkVersion" && it.parameterCount == 1 &&
                            it.parameterTypes[0] == Int::class.javaPrimitiveType
                    }?.invoke(androidExt, 36)
                }
            }.onFailure {
                project.logger.warn(
                    "compileSdk override skipped for ${project.name}: ${it.message}",
                )
            }
        }
    }
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
