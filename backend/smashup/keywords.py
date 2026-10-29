"""Keyword folding shared with the frontend matcher (`smashup/src/analysis/keywordMatch.ts`).

Folding collapses the spelling variety of romanized South-Asian lyrics
(paisa / paisaa / pesa / पैसा) into one comparable form. Keep the rules in
sync with the TypeScript version.
"""

from __future__ import annotations

import re
import unicodedata

# Devanagari → rough Latin. Only what hooks need; vowels signs map to vowels.
_DEVA = {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "ii", "उ": "u", "ऊ": "uu", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
    "ा": "aa", "ि": "i", "ी": "ii", "ु": "u", "ू": "uu", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
    "ं": "n", "ँ": "n", "ः": "h", "्": "",
    "क": "ka", "ख": "kha", "ग": "ga", "घ": "gha", "ङ": "na", "च": "cha", "छ": "chha", "ज": "ja", "झ": "jha",
    "ञ": "na", "ट": "ta", "ठ": "tha", "ड": "da", "ढ": "dha", "ण": "na", "त": "ta", "थ": "tha", "द": "da",
    "ध": "dha", "न": "na", "प": "pa", "फ": "pha", "ब": "ba", "भ": "bha", "म": "ma", "य": "ya", "र": "ra",
    "ल": "la", "व": "va", "श": "sha", "ष": "sha", "स": "sa", "ह": "ha", "़": "",
}
_VOWEL_SIGNS = set("ािीुूेैोौ्ंँ")


def translit(s: str) -> str:
    out: list[str] = []
    for ch in s:
        if ch in _DEVA:
            val = _DEVA[ch]
            # A vowel sign / virama replaces the inherent 'a' of the previous consonant.
            if ch in _VOWEL_SIGNS and out and out[-1].endswith("a") and len(out[-1]) > 1:
                out[-1] = out[-1][:-1]
            out.append(val)
        else:
            out.append(ch)
    return "".join(out)


def fold(word: str) -> str:
    s = translit(word.lower())
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z]", "", s)
    s = s.replace("sh", "s").replace("w", "v").replace("z", "j").replace("ph", "f")
    s = re.sub(r"(ai|ae|ay|ei|ey)", "e", s)
    s = re.sub(r"(ee|ii)", "i", s)
    s = re.sub(r"(oo|uu)", "u", s)
    s = re.sub(r"(.)\1+", r"\1", s)
    if len(s) > 3 and s.endswith("h"):
        s = s[:-1]
    return s


def edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def matches(word: str, aliases: list[str]) -> str | None:
    """Return the folded alias a word matches, or None."""
    f = fold(word)
    if not f:
        return None
    for alias in aliases:
        a = fold(alias)
        if not a:
            continue
        if f == a:
            return a
        if len(a) >= 4 and abs(len(f) - len(a)) <= 1 and edit_distance(f, a) <= 1:
            return a
    return None


def latin_letters(word: str) -> str:
    """MMS aligner vocabulary is lowercase a-z only."""
    s = unicodedata.normalize("NFD", translit(word.lower()))
    return re.sub(r"[^a-z]", "", "".join(c for c in s if unicodedata.category(c) != "Mn"))
