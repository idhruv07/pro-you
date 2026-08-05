import os
import sys
import firebase_admin
from firebase_admin import credentials, firestore
from google.api_core.exceptions import ResourceExhausted

SERVICE_ACCOUNT_FILE = "/Volumes/DJ EX OS/DJ External/.gemini/antigravity/scratch/Mirror/MacReceiver/server/serviceAccountKey.json"

if not os.path.exists(SERVICE_ACCOUNT_FILE):
    print("Service account key file not found.")
    sys.exit(1)

try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    print("Attempting to read a single document from Firestore...")
    # Try to read one document from cache collection to verify if reads are working
    doc_ref = db.collection("cache").document("dashboard_summary")
    doc_snap = doc_ref.get()
    
    if doc_snap.exists:
        print("Success! Firestore reads are working perfectly.")
        print(f"Cache last updated at: {doc_snap.to_dict().get('last_updated_at')}")
    else:
        print("Reads are working, but cache document 'dashboard_summary' does not exist.")
except ResourceExhausted as re:
    print(f"QUOTA_EXCEEDED: Firestore daily read/write quota is exhausted! Details: {re}")
except Exception as e:
    print(f"Error occurred: {e}")
