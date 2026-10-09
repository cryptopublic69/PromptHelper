use objc2::{
    ffi, msg_send,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel, MainThreadMarker,
};
use std::sync::OnceLock;
use tauri::Manager;

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

// Tao currently has no applicationShouldTerminate: delegate method. AppKit's
// Dock Quit bypasses RunEvent::ExitRequested, so intercept it before termination.
// Returning NSTerminateCancel lets the existing frontend review drafts and call
// exit_app only after the user approves and all saves finish.
extern "C-unwind" fn should_terminate(
    _delegate: &AnyObject,
    _selector: Sel,
    _sender: *mut AnyObject,
) -> usize {
    if let Some(app) = APP.get() {
        if app
            .state::<super::AppLifecycle>()
            .exit_approved
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return 1; // NSTerminateNow
        }
        super::request_app_exit(app);
    }
    0 // NSTerminateCancel
}

pub fn install(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let _main_thread = MainThreadMarker::new().ok_or("退出处理必须在主线程初始化")?;
    APP.set(app.clone()).map_err(|_| "退出处理已初始化")?;
    // SAFETY: AppKit and Tao have initialized NSApplication and its delegate by
    // Tauri setup. The delegate remains owned by NSApplication. The callback's
    // signature matches NSUInteger applicationShouldTerminate:(NSApplication *).
    unsafe {
        let class = AnyClass::get(c"NSApplication").ok_or("NSApplication 不可用")?;
        let ns_app: *mut AnyObject = msg_send![class, sharedApplication];
        let delegate: *mut AnyObject = msg_send![ns_app, delegate];
        let delegate = delegate.as_ref().ok_or("应用代理不可用")?;
        let implementation = std::mem::transmute::<
            extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize,
            Imp,
        >(should_terminate);
        let installed = ffi::class_addMethod(
            delegate.class() as *const AnyClass as *mut AnyClass,
            sel!(applicationShouldTerminate:),
            implementation,
            c"Q@:@".as_ptr(),
        );
        if !installed.as_bool() {
            return Err("无法安装应用退出确认处理".into());
        }
    }
    Ok(())
}
