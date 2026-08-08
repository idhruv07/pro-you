import { doc, setDoc, arrayUnion, writeBatch } from '../firebase';

/**
 * Helper to reliably extract the YouTube ID from a video object or its URL.
 * Falls back to the Firestore document ID if neither is available.
 */
export function getYoutubeId(video) {
  if (!video) return null;
  if (video.youtube_id) return video.youtube_id;
  if (video.url) {
    // Matches watch?v=XYZ, shorts/XYZ, embed/XYZ, youtu.be/XYZ
    const match = video.url.match(/(?:v=|shorts\/|embed\/|youtu\.be\/)([^&\s?#]+)/);
    if (match) return match[1];
  }
  return video.id || null;
}

/**
 * Bulk deletes videos and registers them in the system blacklist so they are never re-fetched.
 * 
 * @param {object} firestore - Firestore instance
 * @param {Array} videos - Array of video objects containing { id, youtube_id }
 * @returns {Promise<{ success: boolean, count: number, error?: string }>}
 */
export async function deleteVideosBulk(firestore, videos) {
  if (!Array.isArray(videos) || videos.length === 0) {
    return { success: true, count: 0 };
  }

  const youtubeIds = videos
    .map(v => getYoutubeId(v))
    .filter(Boolean);

  if (youtubeIds.length === 0) {
    return { success: true, count: 0 };
  }

  // 1. Update local storage blacklist for instant zero-latency UI filtering
  try {
    const localDeleted = JSON.parse(localStorage.getItem('ddj_deleted_youtube_ids') || '[]');
    const updatedLocal = Array.from(new Set([...localDeleted, ...youtubeIds]));
    localStorage.setItem('ddj_deleted_youtube_ids', JSON.stringify(updatedLocal));
    
    // Clear feed session cache so it doesn't serve stale cached data
    sessionStorage.removeItem('ddj_feed_session_cache');
  } catch (e) {
    console.warn("Could not save to localStorage deleted list:", e);
  }

  // 2. Perform Firestore operations if connected
  if (firestore) {
    try {
      // Step A: Append youtube_ids to single-document blacklist (1 Write operation)
      const blacklistRef = doc(firestore, "system", "deleted_videos_blacklist");
      await setDoc(blacklistRef, { ids: arrayUnion(...youtubeIds) }, { merge: true });

      // Step B: Batch delete video documents from "videos" collection if document IDs are available
      const batch = writeBatch(firestore);
      let batchCount = 0;

      for (const v of videos) {
        if (v.id) {
          const videoDocRef = doc(firestore, "videos", v.id);
          batch.delete(videoDocRef);
          batchCount++;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      console.log(`Successfully blacklisted ${youtubeIds.length} videos and deleted ${batchCount} video docs.`);
      return { success: true, count: youtubeIds.length };
    } catch (err) {
      console.error("Firestore batch deletion error:", err);
      // Still return success if local storage updated, but log error
      return { success: false, count: youtubeIds.length, error: err.message };
    }
  }

  return { success: true, count: youtubeIds.length };
}

/**
 * Filter out deleted videos based on local storage blacklist.
 * @param {Array} videos 
 * @returns {Array}
 */
export function filterDeletedVideos(videos) {
  if (!Array.isArray(videos)) return [];
  try {
    const deletedIds = new Set(JSON.parse(localStorage.getItem('ddj_deleted_youtube_ids') || '[]'));
    if (deletedIds.size === 0) return videos;
    return videos.filter(v => {
      const yid = getYoutubeId(v);
      return !deletedIds.has(yid) && !deletedIds.has(v.id);
    });
  } catch (e) {
    return videos;
  }
}
