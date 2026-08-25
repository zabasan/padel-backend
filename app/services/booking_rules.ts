/**
 * Duration floor and ceiling for a reservation, enforced on every write path.
 *
 * The floor is a domain rule, not a UI convenience: the complex does not rent a court for
 * less than an hour. The booking grids already refuse to offer a gap shorter than this —
 * `MIN_BOOKING_MINUTES` in `frontend/src/utils/reservations.js` is the same number — but
 * the API is what actually decides, and it used to accept 30. A half-hour reservation
 * created around the UI would sit in a slot no grid can represent and no price range is
 * written for.
 */
export const MIN_BOOKING_MINUTES = 60
export const MAX_BOOKING_MINUTES = 480
