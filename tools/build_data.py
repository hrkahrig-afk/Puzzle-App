"""Builds js/data/*.js word lists from WordNet (npm wordnet-db) + wordfreq.
Usage: python3 tools/build_data.py <path-to-wordnet-db/dict> <out-dir>
"""
import sys, re, json, os
from wordfreq import zipf_frequency, top_n_list

DICT, OUT = sys.argv[1], sys.argv[2]
POS = {'n': 'noun', 'v': 'verb', 'a': 'adj', 'r': 'adv'}

BLOCK = set("""
nigger nigga negro coon spic spick chink gook kike wop dago fag faggot dyke tranny retard retarded
cunt twat fuck fucker shit shitty bitch whore slut cock dick prick pussy tits titty boob boobs
penis vagina anus anal rape raped rapist porn porno semen sperm orgasm erotic horny bastard
damn crap piss pissed arse ass asses arsehole asshole jizz dildo nazi hitler molest incest
pedophile clitoris scrotum testis testes buttock butt hooker pimp napalm suicide
""".split())
FLAG = re.compile(r'\b(slur|offensive|obscene|vulgar|disparaging|derogatory)\b', re.I)
SKIP = re.compile(r'(sexual|genital|copulat|slang|street name|\bpenis|vagina|feces|excrement)', re.I)

def parse_data(pos):
    out = {}
    with open(os.path.join(DICT, 'data.' + pos), encoding='latin-1') as f:
        for line in f:
            if line.startswith('  '):
                continue
            head, _, gloss = line.partition(' | ')
            parts = head.split()
            off = parts[0]
            n = int(parts[3], 16)
            words = [re.sub(r'\(.*\)$', '', parts[4 + 2 * i]) for i in range(n)]
            out[off] = (words, gloss.strip())
    return out

def parse_index(pos):
    out = {}
    with open(os.path.join(DICT, 'index.' + pos), encoding='latin-1') as f:
        for line in f:
            if line.startswith('  '):
                continue
            p = line.split()
            lemma = p[0]
            synset_cnt = int(p[2]); p_cnt = int(p[3])
            tagsense = int(p[5 + p_cnt])
            offs = p[6 + p_cnt:6 + p_cnt + synset_cnt]
            out[lemma] = (tagsense, offs)
    return out

data = {}
index = {}
for k in ['noun', 'verb', 'adj', 'adv']:
    data[k] = parse_data(k)
    index[k] = parse_index(k)

def is_alpha(w):
    return re.fullmatch(r'[a-z]+', w) is not None

def stem_variants(w):
    s = {w}
    for suf in ('s', 'es', 'ed', 'ing', 'er', 'ly', 'y', 'e'):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            s.add(w[:-len(suf)])
    return s

def clean_gloss(g):
    g = g.split(';')[0]
    g = re.sub(r'"[^"]*"', '', g)
    g = re.sub(r'\([^)]*\)', '', g)
    g = re.sub(r'\s+', ' ', g).strip(' ,;:-')
    return g

def mentions(gloss, word):
    toks = set(re.findall(r'[a-z]+', gloss.lower()))
    for v in stem_variants(word):
        for t in toks:
            if t == v or (len(v) >= 4 and t.startswith(v)):
                return True
    return False

def flagged(word):
    for k in index:
        if word in index[k]:
            for off in index[k][word][1]:
                if FLAG.search(data[k][off][1]):
                    return True
    return False

def sense_forms(word, k, off):
    return [w for w in data[k][off][0] if w.lower() == word]

def is_proper_sense(word, k, off):
    f = sense_forms(word, k, off)
    return bool(f) and all(x[0].isupper() for x in f)

def mostly_proper(word):
    tot = prop = 0
    for k in index:
        if word in index[k]:
            for off in index[k][word][1]:
                tot += 1
                prop += is_proper_sense(word, k, off)
    return tot == 0 or prop * 2 >= tot

def make_clue(word):
    c = _make_clue(word, True)
    return c or _make_clue(word, False)

from difflib import SequenceMatcher

def primary_sense(w):
    """(pos, offset) of a word's most common meaning."""
    best = None
    for k in index:
        if w in index[k]:
            ts, offs = index[k][w]
            if best is None or ts > best[0]:
                best = (ts, k, offs[0])
    return best and (best[1], best[2])

def good_synonym(syn, word, k, off):
    """A synonym is a fair clue only if it is common, its own main meaning is
    this sense, and it is not just a spelling/form variant of the answer."""
    if len(syn) < 3 or zipf_frequency(syn, 'en') < 3.3:
        return False
    if primary_sense(syn) != (k, off):
        return False
    if SequenceMatcher(None, syn, word).ratio() > 0.7 or syn[:4] == word[:4]:
        return False
    if mentions(syn, word) or mentions(word, syn):
        return False
    return True

def _make_clue(word, common_only):
    """Pick a clue from the word's most common part of speech/senses."""
    cands = []
    for k in index:
        if word in index[k]:
            ts, offs = index[k][word]
            cands.append((ts, k, offs))
    if not cands:
        return None
    cands.sort(key=lambda c: -c[0])
    best_syn = None
    for ts, k, offs in cands:
        for i, off in enumerate(offs[:3]):
            words, gloss = data[k][off]
            if SKIP.search(gloss) or (common_only and is_proper_sense(word, k, off)):
                continue
            g = clean_gloss(gloss)
            if 6 <= len(g) <= 55 and not mentions(g, word):
                return g[0].upper() + g[1:]
            if best_syn is None and i < 2:
                for s in words:
                    sl = s.lower()
                    if sl != word and is_alpha(sl) and good_synonym(sl, word, k, off):
                        best_syn = sl[0].upper() + sl[1:]
                        break
    if best_syn:
        return best_syn
    for ts, k, offs in cands:
        for off in offs[:3]:
            if SKIP.search(data[k][off][1]) or (common_only and is_proper_sense(word, k, off)):
                continue
            g = clean_gloss(data[k][off][1])
            if 6 <= len(g) <= 90 and not mentions(g, word):
                return g[0].upper() + g[1:]
    # truncated long gloss as last resort
    for ts, k, offs in cands:
        g = clean_gloss(data[k][offs[0]][1])
        if SKIP.search(g):
            continue
        g = re.split(r',| that | which ', g)[0] if len(g) > 90 else g
        if len(g) > 6 and not mentions(g, word):
            cut = g[:90].rsplit(' ', 1)[0] if len(g) > 90 else g
            cut = re.sub(r'\b(of|or|and|the|a|an|to|in|by|for|with|that|which)$', '', cut).strip(' ,')
            return cut[0].upper() + cut[1:]
    return None

all_lemmas = set()
for k in index:
    all_lemmas.update(w for w in index[k] if is_alpha(w))

# ---------------- crossword ----------------
cw = {}
for w in all_lemmas:
    if not (3 <= len(w) <= 15) or w in BLOCK:
        continue
    z = zipf_frequency(w, 'en')
    if z < 2.6:
        continue
    if flagged(w):
        continue
    c = make_clue(w)
    if c:
        cw[w] = (c, z)
print('crossword words', len(cw), file=sys.stderr)

# ---------------- wordle ----------------
verbs = index['verb']
nouns = index['noun']
def plural_or_past(w):
    if w.endswith('s') and not w.endswith('ss') and (w[:-1] in nouns or w[:-1] in verbs or (w.endswith('es') and w[:-2] in nouns)):
        return True
    if w.endswith('ed') and (w[:-1] in verbs or w[:-2] in verbs or (len(w) > 3 and w[:-3] in verbs)):
        return True
    return False

answers = sorted(w for w in all_lemmas if len(w) == 5 and w not in BLOCK and zipf_frequency(w, 'en') >= 3.0
                 and not plural_or_past(w) and not flagged(w) and not mostly_proper(w))
guesses = set(answers)
for w in top_n_list('en', 400000):
    if len(w) == 5 and is_alpha(w) and zipf_frequency(w, 'en') >= 1.0:
        guesses.add(w)
guesses.update(w for w in all_lemmas if len(w) == 5)
guesses -= set(answers)
print('wordle answers', len(answers), 'extra guesses', len(guesses), file=sys.stderr)

os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'words5.js'), 'w') as f:
    f.write('// Generated by tools/build_data.py\n')
    f.write('export const ANSWERS = ' + json.dumps(' '.join(answers)) + '.split(" ");\n')
    f.write('export const GUESSES = ' + json.dumps(' '.join(sorted(guesses))) + '.split(" ");\n')

# Crossword list: word|clue lines sorted by frequency (best first)
items = sorted(cw.items(), key=lambda kv: -kv[1][1])
with open(os.path.join(OUT, 'clues.json'), 'w') as f:
    json.dump([[w, c, round(z, 1)] for w, (c, z) in items], f, separators=(',', ':'))
