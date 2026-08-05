import os
import firebase_admin
from firebase_admin import credentials, firestore

def prune_blacklisted_videos():
    # Setup Service Account
    cred_path = os.environ.get(
        'FIREBASE_SERVICE_ACCOUNT_PATH',
        '/Volumes/DJ EX OS/DJ External/.gemini/antigravity/scratch/Mirror/MacReceiver/server/serviceAccountKey.json'
    )
    
    if not firebase_admin._apps:
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
        
    db = firestore.client()
    
    # 1. Fetch all blacklisted channel IDs
    blacklist_ids = set()
    for d in db.collection('blacklisted_channels').stream():
        blacklist_ids.add(d.id)
        c_id = d.to_dict().get('channel_id')
        if c_id:
            blacklist_ids.add(c_id)
            
    print(f"Loaded {len(blacklist_ids)} blacklisted channel IDs.")
    
    # 2. Query and delete videos belonging to these channels
    videos_ref = db.collection('videos')
    deleted_count = 0
    
    # Process in batches to avoid memory issues and print progress
    for channel_id in blacklist_ids:
        docs = list(videos_ref.where('channel_id', '==', channel_id).stream())
        if docs:
            print(f"Pruning {len(docs)} videos for blacklisted channel ID: {channel_id}")
            for d in docs:
                d.reference.delete()
                deleted_count += 1
                
    print(f"Success! Cleaned up {deleted_count} stray videos belonging to blacklisted channels.")

if __name__ == '__main__':
    try:
        prune_blacklisted_videos()
    except Exception as e:
        print(f"Prune failed: {e}")
