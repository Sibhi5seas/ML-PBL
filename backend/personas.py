"""Taste personas.

Used in two places:
  1. the UI "Taste Orbit" (one-tap starter profiles), and
  2. the synthetic-rating generator (so the demo ratings have real structure
     for collaborative filtering to learn from).
"""

PERSONAS = [
    dict(key="kollywood", name="Kollywood Mass", tagline="Whistle-worthy Tamil action & drama",
         hue=32, langs={"Tamil": 1.0}, genres={"Action": .8, "Drama": .5, "Thriller": .6, "Crime": .5, "Comedy": .3}),
    dict(key="bollywood", name="Bollywood Romantic", tagline="Songs, soul and sweeping love stories",
         hue=335, langs={"Hindi": 1.0}, genres={"Romance": 1, "Musical": .9, "Drama": .6, "Comedy": .7, "Family": .5}),
    dict(key="tollywood", name="Epic Spectacle", tagline="Telugu & Kannada larger-than-life sagas",
         hue=18, langs={"Telugu": 1.0, "Kannada": .9}, genres={"Action": 1, "Fantasy": .8, "Adventure": .8, "Drama": .4}),
    dict(key="mollywood", name="Mollywood Realist", tagline="Grounded, character-first Malayalam cinema",
         hue=160, langs={"Malayalam": 1.0, "Kannada": .4}, genres={"Drama": 1, "Crime": .8, "Thriller": .8, "Comedy": .5, "Mystery": .6}),
    dict(key="hollywood", name="Hollywood Blockbuster", tagline="Tentpole action, adventure and spectacle",
         hue=215, langs={"English": 1.0}, genres={"Action": 1, "Adventure": .9, "Sci-Fi": .8, "Fantasy": .6}),
    dict(key="scifi", name="Sci-Fi Dreamer", tagline="Big ideas across every language",
         hue=265, langs={"English": .6, "Tamil": .5, "Hindi": .4, "Telugu": .4}, genres={"Sci-Fi": 1, "Fantasy": .6, "Adventure": .5, "Mystery": .5}),
    dict(key="crime", name="Crime & Suspense", tagline="Heists, whodunits and moral grey",
         hue=0, langs={"English": .6, "Hindi": .6, "Tamil": .6, "Malayalam": .6, "Kannada": .5}, genres={"Crime": 1, "Thriller": 1, "Mystery": .8}),
    dict(key="family", name="Animation & Family", tagline="Warm, colourful stories for everyone",
         hue=48, langs={"English": .8, "Hindi": .5, "Tamil": .3}, genres={"Animation": 1, "Family": 1, "Comedy": .6, "Musical": .6, "Fantasy": .5, "Adventure": .5}),
    dict(key="auteur", name="Art-house Classicist", tagline="Ray, Ghatak and the humanist tradition",
         hue=190, langs={"Bengali": 1.0, "Marathi": .8, "Hindi": .5, "Malayalam": .5, "English": .4}, genres={"Drama": 1, "Romance": .5, "Biography": .6, "History": .6, "War": .5}),
]

BY_KEY = {p["key"]: p for p in PERSONAS}


def affinity(persona, language, genres):
    """0..~1.4 affinity of a persona for a movie."""
    lang_w = persona["langs"].get(language, 0.0)
    gw = [persona["genres"].get(g, 0.0) for g in genres]
    genre_w = max(gw) * 0.7 + (sum(gw) / len(gw)) * 0.3 if gw else 0.0
    return 0.6 * lang_w + 0.8 * genre_w
