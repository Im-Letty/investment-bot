"""Code-selected website copy limits; model output cannot select this policy.

Flexible copy aims for 200–300 characters in the overview and 200–400 in a
detail. Ten percent extra room preserves necessary explanations/qualifications.
The lower target is guidance: never pad correct copy to reach a character count.
Nonempty text still needs all existing source, readability and final-review gates.
Unmarked saved/LINE copy keeps the legacy strict limits.
"""

COPY_LENGTH_POLICY = "flexible-v1"


def summary_bounds(role, policy=None):
    if role not in ("overview", "article"):
        raise ValueError("invalid_copy_role")
    if policy is None:
        return (200, 300)
    if policy != COPY_LENGTH_POLICY:
        raise ValueError("invalid_copy_length_policy")
    return (1, 330 if role == "overview" else 440)
