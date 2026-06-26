use std::{
    io,
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

const QUIET_OUTPUT_TIMEOUT: Duration = Duration::from_secs(10);

pub fn spawn_quiet(command: &mut Command) -> io::Result<Child> {
    configure_quiet(command);
    command.spawn()
}

pub fn output_quiet(command: &mut Command) -> io::Result<Output> {
    configure_quiet(command);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let deadline = Instant::now() + QUIET_OUTPUT_TIMEOUT;
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output();
        }
        if Instant::now() >= deadline {
            terminate_child_tree(&mut child);
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "helper command timed out",
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

pub fn terminate_child_tree(child: &mut Child) {
    terminate_platform_tree(child);
    let _ = child.kill();
    let _ = child.wait();
}

fn configure_quiet(command: &mut Command) {
    configure_platform(command);
}

#[cfg(windows)]
fn configure_platform(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(windows)]
fn terminate_platform_tree(child: &mut Child) {
    let mut command = Command::new("taskkill.exe");
    command
        .arg("/PID")
        .arg(child.id().to_string())
        .arg("/T")
        .arg("/F");
    configure_quiet(&mut command);
    let _ = command.status();
}

#[cfg(unix)]
fn configure_platform(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // Detach helper tools from the app process group so closing a terminal or parent shell
    // does not signal long-running exports/editors.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(unix)]
fn terminate_platform_tree(child: &mut Child) {
    let process_group = -(child.id() as i32);
    unsafe {
        let _ = libc::kill(process_group, libc::SIGKILL);
    }
}

#[cfg(not(any(windows, unix)))]
fn configure_platform(_command: &mut Command) {}

#[cfg(not(any(windows, unix)))]
fn terminate_platform_tree(_child: &mut Child) {}
