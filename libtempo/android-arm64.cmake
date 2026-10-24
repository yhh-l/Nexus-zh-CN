# libtempo's Android ARM64 toolchain. C/C++ and libc come from the NDK; Fortran
# comes from a real LLVM Flang frontend and an Android-built runtime prefix.
# This does not select a Linux ARM64 compiler or permit host pkg-config libraries.
# Android 15/API 35 is the initial S25 Ultra acceptance baseline, not a claim of
# compatibility with older phones. No compiler-success checks are bypassed.
if(NOT ANDROID_NDK OR NOT EXISTS "${ANDROID_NDK}/build/cmake/android.toolchain.cmake")
    message(FATAL_ERROR "ANDROID_NDK must name an Android NDK installation")
endif()
if(NOT NEXUS_ANDROID_FLANG OR NOT EXISTS "${NEXUS_ANDROID_FLANG}")
    message(FATAL_ERROR "NEXUS_ANDROID_FLANG must name the LLVM Flang executable")
endif()
if(NOT ANDROID_PLATFORM STREQUAL "android-35")
    message(FATAL_ERROR "Initial Nexus ARM64 native port requires ANDROID_PLATFORM=android-35")
endif()
set(ANDROID_ABI "arm64-v8a" CACHE STRING "Nexus phone ABI" FORCE)
set(ANDROID_STL "c++_static" CACHE STRING "Ship the Android C++ runtime with Nexus" FORCE)
include("${ANDROID_NDK}/build/cmake/android.toolchain.cmake")
set(CMAKE_Fortran_COMPILER "${NEXUS_ANDROID_FLANG}" CACHE FILEPATH "Android Fortran frontend")
set(CMAKE_Fortran_COMPILER_TARGET "aarch64-linux-android35")
set(CMAKE_Fortran_FLAGS_INIT "--sysroot=\"${CMAKE_SYSROOT}\" -fPIC")
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
# Propagate inputs to CMake's nested compiler checks as well as the main build.
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES
    ANDROID_NDK ANDROID_PLATFORM NEXUS_ANDROID_FLANG NEXUS_ANDROID_PREFIX)
