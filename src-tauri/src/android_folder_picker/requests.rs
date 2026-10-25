//! Single active Android chooser ownership, shared by the JNI bridge and real host tests.
//! A busy request is never replaced; stale callbacks/cancellation cannot steal its result.

pub(crate) struct Requests<T> {
    current: Option<(i64, T)>,
}

impl<T> Requests<T> {
    pub(crate) const fn new() -> Self {
        Self { current: None }
    }

    pub(crate) fn start(&mut self, id: i64, value: T) -> Result<(), T> {
        if self.current.is_some() {
            return Err(value);
        }
        self.current = Some((id, value));
        Ok(())
    }

    pub(crate) fn take(&mut self, id: i64) -> Option<T> {
        match self.current.as_ref() {
            Some((active, _)) if *active == id => self.current.take().map(|(_, value)| value),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_requests_do_not_replace_the_active_selection() {
        let mut requests = Requests::new();
        assert_eq!(requests.start(1, "first"), Ok(()));
        assert_eq!(requests.start(2, "second"), Err("second"));
        assert_eq!(requests.take(2), None);
        assert_eq!(requests.take(1), Some("first"));
        assert_eq!(requests.take(1), None);
    }

    #[test]
    fn old_callbacks_and_cancellation_cannot_complete_a_new_request() {
        let mut requests = Requests::new();
        assert_eq!(requests.start(1, "old"), Ok(()));
        assert_eq!(requests.take(1), Some("old"));
        assert_eq!(requests.start(2, "new"), Ok(()));
        assert_eq!(requests.take(1), None);
        assert_eq!(requests.take(2), Some("new"));
        assert_eq!(requests.take(2), None);
    }
}
