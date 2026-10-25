package nexus.fixture;

/** Original test fixture, not an Android USB implementation or device simulation. */
public final class FixtureUsb {
    private final boolean packetFailure;
    private final boolean closeFailure;
    public int closeCount = 0;

    public FixtureUsb(boolean packetFailure, boolean closeFailure) {
        this.packetFailure = packetFailure;
        this.closeFailure = closeFailure;
    }

    public int packetBytes() {
        if (packetFailure) throw new IllegalStateException("fixture packet failure");
        return 512;
    }

    public void close() {
        closeCount++;
        if (closeFailure) throw new IllegalStateException("fixture cleanup failure");
    }
}
