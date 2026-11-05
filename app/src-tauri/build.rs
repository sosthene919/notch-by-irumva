fn main() {
    // Import libraries for documented Win32 APIs used via FFI in native.rs/security.rs.
    #[cfg(windows)]
    {
        println!("cargo:rustc-link-lib=wtsapi32"); // WTSRegisterSessionNotification
        println!("cargo:rustc-link-lib=bcrypt"); // BCryptGenRandom
        println!("cargo:rustc-link-lib=crypt32"); // CryptProtectData / CryptUnprotectData (DPAPI)
    }
    tauri_build::build()
}
