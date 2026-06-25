//! The transport seam.
//!
//! All host interaction goes through [`Transport`] so the CLI's logic (path mapping, session
//! naming, attach decisions, onboarding) is testable without a real macOS host. The real impl
//! (P2) spawns native OpenSSH `ssh.exe`; tests use [`MockTransport`], which records the exact
//! argv it was asked to run — mirroring the bash `tests/lib.sh` MOCKLOG argv-capture approach.

use std::cell::RefCell;

/// Result of running a remote command: process exit code + captured stdout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Output {
    pub code: i32,
    pub stdout: String,
}

/// Abstraction over "run things against the host". P0 defines `ssh_exec`; `attach`, `reach`,
/// and `dir_check` are added in P2 as the launch/attach path is ported.
pub trait Transport {
    /// Run `remote_cmd` (already a POSIX-safe payload — see [`crate::remote_quote`]) on `host`.
    fn ssh_exec(&self, host: &str, remote_cmd: &str) -> std::io::Result<Output>;
}

/// A record of one transport call, for assertions in tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Call {
    pub host: String,
    pub remote_cmd: String,
}

/// Test transport: returns canned [`Output`]s and records every call's argv.
#[derive(Default)]
pub struct MockTransport {
    calls: RefCell<Vec<Call>>,
    responses: RefCell<Vec<Output>>,
}

impl MockTransport {
    pub fn new() -> Self {
        Self::default()
    }

    /// Queue a canned response (FIFO). When exhausted, `ssh_exec` returns `(0, "")`.
    pub fn push_response(&self, code: i32, stdout: &str) {
        self.responses.borrow_mut().push(Output {
            code,
            stdout: stdout.to_string(),
        });
    }

    /// The calls recorded so far, in order.
    pub fn calls(&self) -> Vec<Call> {
        self.calls.borrow().clone()
    }
}

impl Transport for MockTransport {
    fn ssh_exec(&self, host: &str, remote_cmd: &str) -> std::io::Result<Output> {
        self.calls.borrow_mut().push(Call {
            host: host.to_string(),
            remote_cmd: remote_cmd.to_string(),
        });
        let mut resp = self.responses.borrow_mut();
        Ok(if resp.is_empty() {
            Output {
                code: 0,
                stdout: String::new(),
            }
        } else {
            resp.remove(0)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_records_calls_and_returns_canned_output() {
        let t = MockTransport::new();
        t.push_response(0, "session-exists");
        let out = t.ssh_exec("host.local", "'tmux-aqua' 'has-session'").unwrap();
        assert_eq!(out, Output { code: 0, stdout: "session-exists".into() });
        let calls = t.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].host, "host.local");
        assert_eq!(calls[0].remote_cmd, "'tmux-aqua' 'has-session'");
    }

    #[test]
    fn mock_defaults_to_zero_when_responses_exhausted() {
        let t = MockTransport::new();
        let out = t.ssh_exec("h", "echo hi").unwrap();
        assert_eq!(out, Output { code: 0, stdout: String::new() });
    }
}
