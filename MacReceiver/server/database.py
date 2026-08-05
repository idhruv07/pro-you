import os
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import logging

logger = logging.getLogger(__name__)

# Initialize Firebase
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICE_ACCOUNT_FILE = os.path.join(BASE_DIR, "serviceAccountKey.json")

db = None

try:
    sa_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if sa_env:
        import json
        cred_dict = json.loads(sa_env)
        cred = credentials.Certificate(cred_dict)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        logger.info("Successfully connected to Firebase Firestore via env var.")
    elif os.path.exists(SERVICE_ACCOUNT_FILE):
        cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        logger.info("Successfully connected to Firebase Firestore via file.")
    else:
        logger.error(f"serviceAccountKey.json not found at {SERVICE_ACCOUNT_FILE}")
except Exception as e:
    logger.error(f"Error initializing Firebase: {e}")

def get_db():
    return db
