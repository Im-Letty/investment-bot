"""Code-selected website copy limits; model output cannot select this policy.

Flexible copy aims for 200–300 characters in the overview and 200–400 in a
detail. Ten percent extra room preserves necessary explanations/qualifications.
The lower target is guidance: never pad correct copy to reach a character count.
Nonempty text still needs all existing source, readability and final-review gates.
Unmarked saved/LINE copy keeps the legacy strict limits.
"""

COPY_LENGTH_POLICY = "flexible-v1"

MONEY_DISPLAY_INSTRUCTION = (
    "金額は値や通貨・単位を変えず、小数部の末尾の0を省きます"
    "（1,000.00円は1,000円、55.50円は55.5円）。"
    "実際の端数を整数へ丸めず、割合や比較条件の精度は維持します。\n"
)


def summary_bounds(role, policy=None):
    if role not in ("overview", "article"):
        raise ValueError("invalid_copy_role")
    if policy is None:
        return (200, 300)
    if policy != COPY_LENGTH_POLICY:
        raise ValueError("invalid_copy_length_policy")
    return (1, 330 if role == "overview" else 440)
