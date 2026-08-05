package com.example.mirror

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import java.io.IOException
import java.io.OutputStream
import java.net.Socket
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

class ScreenCaptureService : Service() {

    companion object {
        const val ACTION_START = "ACTION_START"
        const val ACTION_STOP  = "ACTION_STOP"
        const val EXTRA_RESULT_CODE = "EXTRA_RESULT_CODE"
        const val EXTRA_RESULT_DATA = "EXTRA_RESULT_DATA"
        const val EXTRA_IP          = "EXTRA_IP"

        private const val CHANNEL_ID   = "MirrorServiceChannel"
        private const val TAG          = "ScreenMirror"
        private const val FRAME_MAGIC  = 0xDEADBEEF.toInt()
        private const val PORT         = 5001
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay:  VirtualDisplay?  = null
    private var mediaCodec:      MediaCodec?      = null
    private var socket:          Socket?          = null
    private var outputStream:    OutputStream?    = null
    private val isRunning        = AtomicBoolean(false)
    private var workerThread:    Thread?          = null
    private val mainHandler      = Handler(Looper.getMainLooper())

    // Required callback — Android 14 will stop the projection if this is not registered
    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            Log.e(TAG, "MediaProjection stopped by system")
            broadcast("Mirroring stopped by system.")
            stopProjection()
            stopSelf()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.e(TAG, ">>> onCreate called")
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.e(TAG, ">>> onStartCommand action=${intent?.action}")

        when (intent?.action) {
            ACTION_START -> {
                // Must call startForeground IMMEDIATELY with the media_projection type
                startForegroundNow()

                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
                @Suppress("DEPRECATION")
                val resultData: Intent? = intent.getParcelableExtra(EXTRA_RESULT_DATA)
                val ip = intent.getStringExtra(EXTRA_IP)

                Log.e(TAG, ">>> resultCode=$resultCode, ip=$ip, hasData=${resultData != null}")

                if (resultCode == Activity.RESULT_OK && resultData != null && !ip.isNullOrBlank()) {
                    broadcast("Service started for $ip")
                    startProjection(resultCode, resultData, ip)
                } else {
                    Log.e(TAG, ">>> MISSING DATA — RC=$resultCode ip=$ip data=${resultData != null}")
                    broadcast("Error: missing permission data RC=$resultCode")
                    stopSelf()
                }
            }
            ACTION_STOP -> {
                stopProjection()
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    // ── Foreground notification ───────────────────────────────────────────────

    private fun startForegroundNow() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                1, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(1, notification)
        }
        Log.e(TAG, ">>> startForeground done")
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        // Use a system drawable guaranteed to exist on all devices
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Mirror — Streaming Active")
            .setContentText("Streaming screen to Mac")
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "Mirror Service",
                NotificationManager.IMPORTANCE_HIGH
            )
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }

    // ── Projection setup ─────────────────────────────────────────────────────

    private fun startProjection(resultCode: Int, data: Intent, ip: String) {
        try {
            val mpManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = mpManager.getMediaProjection(resultCode, data)

            if (mediaProjection == null) {
                Log.e(TAG, ">>> MediaProjection is NULL — permission denied?")
                broadcast("Error: screen capture permission denied")
                stopSelf()
                return
            }

            // REQUIRED on Android 14+ — register callback before using the projection
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                mediaProjection!!.registerCallback(projectionCallback, mainHandler)
            } else {
                mediaProjection!!.registerCallback(projectionCallback, null)
            }

            Log.e(TAG, ">>> MediaProjection created OK, starting worker thread")

            workerThread = Thread {
                try {
                    connectAndStream(ip)
                } catch (e: Exception) {
                    Log.e(TAG, ">>> Stream thread error", e)
                    broadcast("Stream error: ${e.message}")
                } finally {
                    stopProjection()
                    stopSelf()
                }
            }.also { it.start() }

        } catch (e: Exception) {
            Log.e(TAG, ">>> startProjection exception", e)
            broadcast("Setup error: ${e.message}")
            stopSelf()
        }
    }

    // ── Streaming loop ───────────────────────────────────────────────────────

    private fun connectAndStream(ip: String) {
        // Portrait 720p for better phone compatibility
        val screenWidth  = 720
        val screenHeight = 1280
        val dpi          = 320
        val bitrate      = 2_000_000
        val frameRate    = 25

        Log.e(TAG, ">>> connectAndStream to $ip : $PORT")
        broadcast("Setting up encoder...")

        // ── Step 1: Configure MediaCodec ──────────────────────────────────
        val format = MediaFormat.createVideoFormat(
            MediaFormat.MIMETYPE_VIDEO_AVC, screenWidth, screenHeight
        ).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE,     bitrate)
            setInteger(MediaFormat.KEY_FRAME_RATE,   frameRate)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }

        mediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        mediaCodec!!.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = mediaCodec!!.createInputSurface()
        mediaCodec!!.start()
        Log.e(TAG, ">>> Codec started")

        // ── Step 2: Create VirtualDisplay ─────────────────────────────────
        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "MirrorDisplay",
            screenWidth, screenHeight, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            surface, null, null
        )

        if (virtualDisplay == null) {
            Log.e(TAG, ">>> VirtualDisplay is NULL")
            broadcast("Error: could not create virtual display")
            return
        }
        Log.e(TAG, ">>> VirtualDisplay created OK")

        // ── Step 3: Connect socket ────────────────────────────────────────
        broadcast("Connecting to $ip:$PORT...")
        socket = Socket()
        socket!!.connect(java.net.InetSocketAddress(ip, PORT), 5000)
        socket!!.tcpNoDelay = true
        outputStream = socket!!.getOutputStream()

        // ── Step 4: Handshake ─────────────────────────────────────────────
        outputStream!!.write("MIRROR_START".toByteArray(Charsets.US_ASCII))
        outputStream!!.flush()
        Log.e(TAG, ">>> Handshake sent")
        broadcast("Connected! Streaming ${screenWidth}x${screenHeight}")

        // ── Step 5: Encode and send frames ────────────────────────────────
        val bufferInfo = MediaCodec.BufferInfo()
        isRunning.set(true)

        while (isRunning.get()) {
            val index = mediaCodec!!.dequeueOutputBuffer(bufferInfo, 10_000L)

            when {
                index >= 0 -> {
                    val buffer = mediaCodec!!.getOutputBuffer(index)
                    if (buffer == null) {
                        mediaCodec!!.releaseOutputBuffer(index, false)
                    } else {
                        if (bufferInfo.size > 0) {
                            val data = ByteArray(bufferInfo.size)
                            buffer.position(bufferInfo.offset)
                            buffer.limit(bufferInfo.offset + bufferInfo.size)
                            buffer.get(data)
                            try {
                                writeFramed(outputStream!!, data)
                            } catch (e: IOException) {
                                Log.e(TAG, ">>> Write error", e)
                                isRunning.set(false)
                            }
                        }
                        mediaCodec!!.releaseOutputBuffer(index, false)
                    }
                }
                index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    val fmt = mediaCodec!!.outputFormat
                    val sps = fmt.getByteBuffer("csd-0")
                    val pps = fmt.getByteBuffer("csd-1")
                    if (sps != null && pps != null) {
                        val config = ByteArray(sps.remaining() + pps.remaining())
                        sps.get(config, 0, sps.remaining())
                        pps.get(config, sps.capacity(), pps.remaining())
                        try { writeFramed(outputStream!!, config) }
                        catch (e: IOException) { Log.e(TAG, ">>> Config write error", e); break }
                    }
                    Log.e(TAG, ">>> Output format changed: ${mediaCodec!!.outputFormat}")
                }
            }
        }
        Log.e(TAG, ">>> Stream loop exited")
    }

    private fun writeFramed(os: OutputStream, data: ByteArray) {
        val header = ByteBuffer.allocate(8)
        header.putInt(FRAME_MAGIC)
        header.putInt(data.size)
        os.write(header.array())
        os.write(data)
        os.flush()
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

    private fun stopProjection() {
        if (!isRunning.compareAndSet(true, false)) return
        Log.e(TAG, ">>> stopProjection")
        try { outputStream?.close()   } catch (_: Exception) {}
        try { socket?.close()         } catch (_: Exception) {}
        try { virtualDisplay?.release()  } catch (_: Exception) {}
        try { mediaCodec?.stop()      } catch (_: Exception) {}
        try { mediaCodec?.release()   } catch (_: Exception) {}
        try { mediaProjection?.unregisterCallback(projectionCallback) } catch (_: Exception) {}
        try { mediaProjection?.stop() } catch (_: Exception) {}
        broadcast("Mirroring stopped.")
    }

    private fun broadcast(msg: String) {
        Log.e(TAG, ">>> $msg")
        mainHandler.post { Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show() }
        sendBroadcast(Intent("com.example.mirror.LOG").putExtra("log", msg))
    }
}
