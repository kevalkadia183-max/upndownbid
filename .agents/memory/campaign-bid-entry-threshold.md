---
name: Campaign bid entry threshold
description: The public campaign opening-bid rule and its intended input behavior.
---

Public campaign claims use an inclusive floor: a bid must be a whole-dollar amount at least the configured campaign minimum and never less than $5. The amount field must remain freely editable while the user types.

**Why:** The opening amount is a validation rule, not a fixed bid value. The $5 floor is the public product rule, and clamping each keystroke makes it impossible to replace the initial amount on mobile keyboards.

**How to apply:** Keep temporary blank input state during editing; validate only for preview/checkout and on the server. Use whole-dollar bid controls, with $5 accepted when the campaign minimum is $5 and a higher configured campaign floor honored.