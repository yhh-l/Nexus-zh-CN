//! Shared name-discovery contract for portable account enrolment and the Windows LAN window.
//! Keeping this callback outside the window origin lets the account road remain available on
//! every platform; the discovery timeout and callback behavior are unchanged.
use std::sync::Arc;
use std::time::Duration;

use tempo_stream::lan::dnssd::{Found, Unavailable};

/// How long a look for stations by name listens for their answers.
pub(crate) const FIND_FOR: Duration = Duration::from_secs(3);

/// The stations that answer by name within a wait (`tempo_stream::lan::dnssd::find`). It blocks
/// for that long, so it is only called on a thread that may wait.
pub(crate) type Find = Arc<dyn Fn(Duration) -> Result<Vec<Found>, Unavailable> + Send + Sync>;
