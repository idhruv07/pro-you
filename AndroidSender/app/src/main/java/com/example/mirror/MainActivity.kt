package com.example.mirror

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import android.os.Build
import android.widget.Spinner
import android.widget.ArrayAdapter
import android.view.View
import android.widget.AdapterView
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

class MainActivity : AppCompatActivity() {

    private lateinit var mediaProjectionManager: MediaProjectionManager
    private lateinit var btnToggle: Button
    private lateinit var etIpAddress: EditText
    private lateinit var btnScan: Button
    private lateinit var spReceivers: Spinner
    private val discoveredIps = ArrayList<String>()
    private lateinit var spinnerAdapter: ArrayAdapter<String>
    private var isMirroring = false

    private val screenCaptureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            startMirroringService(result.resultCode, result.data!!)
        } else {
            Toast.makeText(this, "Permission denied", Toast.LENGTH_SHORT).show()
            isMirroring = false
            updateUi()
        }
    }

    private lateinit var tvLogs: android.widget.TextView
    
    private val logReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val log = intent?.getStringExtra("log") ?: return
            tvLogs.append("$log\n")
            // Scroll to bottom
            val scrollView = tvLogs.parent as android.widget.ScrollView
            scrollView.post { scrollView.fullScroll(android.view.View.FOCUS_DOWN) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvLogs = findViewById(R.id.tvLogs)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            registerReceiver(logReceiver, android.content.IntentFilter("com.example.mirror.LOG"),
                RECEIVER_NOT_EXPORTED)
        } else {
             registerReceiver(logReceiver, android.content.IntentFilter("com.example.mirror.LOG"))
        }

        mediaProjectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        
        btnToggle = findViewById(R.id.btnToggle)
        etIpAddress = findViewById(R.id.etIpAddress)
        btnScan = findViewById(R.id.btnScan)
        spReceivers = findViewById(R.id.spReceivers)

        spinnerAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, discoveredIps)
        spinnerAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        spReceivers.adapter = spinnerAdapter

        spReceivers.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (position >= 0 && position < discoveredIps.size) {
                    etIpAddress.setText(discoveredIps[position])
                }
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        btnScan.setOnClickListener {
            startUdpDiscovery()
        }

        val prefs = getSharedPreferences("MirrorPrefs", Context.MODE_PRIVATE)
        val lastIp = prefs.getString("LAST_IP", "192.168.1.100")
        etIpAddress.setText(lastIp)

        // Auto-scan on launch
        startUdpDiscovery()
        startPassiveBeaconListener()

        val btnTestConnection = findViewById<Button>(R.id.btnTestConnection)
        btnTestConnection.setOnClickListener {
            val ip = etIpAddress.text.toString()
            if (ip.isBlank()) return@setOnClickListener
            
            log("Testing connection to $ip...")
            
            Thread {
                try {
                    val socket = java.net.Socket()
                    socket.connect(java.net.InetSocketAddress(ip, 5001), 3000)
                    socket.close()
                    runOnUiThread {
                       log("SUCCESS! Connected to Mac.")
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                    runOnUiThread {
                        log("FAILED: ${e.message}")
                    }
                }
            }.start()
        }

        btnToggle.setOnClickListener {
            if (isMirroring) {
                stopMirroringService()
            } else {
                val ip = etIpAddress.text.toString()
                if (ip.isBlank()) {
                    Toast.makeText(this, "Enter IP Address", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                
                prefs.edit().putString("LAST_IP", ip).apply()
                
                isMirroring = true
                updateUi()
                // Request Permission
                screenCaptureLauncher.launch(mediaProjectionManager.createScreenCaptureIntent())
            }
        }

        // --- Tab and WebView Dashboard Integration ---
        val layoutMirroringContent = findViewById<View>(R.id.layoutMirroringContent)
        val webViewDashboard = findViewById<WebView>(R.id.webViewDashboard)
        val btnTabMirror = findViewById<LinearLayout>(R.id.btnTabMirror)
        val btnTabDashboard = findViewById<LinearLayout>(R.id.btnTabDashboard)
        val tvTabMirrorText = findViewById<TextView>(R.id.tvTabMirrorText)
        val tvTabDashboardText = findViewById<TextView>(R.id.tvTabDashboardText)

        // Setup WebView
        webViewDashboard.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setSupportMultipleWindows(true) // Enable support for window.open popups
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        }
        
        webViewDashboard.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                view.loadUrl(url)
                return true
            }
        }

        // Handle popup windows (like Firebase Google Auth popup) inside an overlay dialog
        webViewDashboard.webChromeClient = object : android.webkit.WebChromeClient() {
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message?
            ): Boolean {
                val context = this@MainActivity
                val dialog = android.app.Dialog(context, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
                val dialogWebView = WebView(context).apply {
                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        databaseEnabled = true
                        javaScriptCanOpenWindowsAutomatically = true
                        userAgentString = view?.settings?.userAgentString
                    }
                    webViewClient = object : WebViewClient() {
                        var googleLoginStarted = false

                        override fun onPageStarted(wView: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                            super.onPageStarted(wView, url, favicon)
                            if (url != null && url.contains("google.com")) {
                                googleLoginStarted = true
                            }
                        }

                        override fun onPageFinished(wView: WebView?, url: String?) {
                            super.onPageFinished(wView, url)
                            // If successfully redirected back to the Firebase OAuth handler page after login
                            if (googleLoginStarted && url != null && 
                                (url.contains("fir-c028b.web.app") || (url.contains("firebaseapp.com") && url.contains("auth/handler")))
                            ) {
                                postDelayed({
                                    try {
                                        dialog.dismiss()
                                    } catch (e: Exception) {}
                                }, 1500) // Delay to ensure auth token postMessage is completed
                            }
                        }
                    }
                    webChromeClient = object : android.webkit.WebChromeClient() {
                        override fun onCloseWindow(window: WebView?) {
                            try {
                                dialog.dismiss()
                            } catch (e: Exception) {}
                        }
                    }
                }

                dialog.setContentView(dialogWebView)
                dialog.setOnDismissListener {
                    dialogWebView.destroy()
                }
                dialog.show()

                val transport = resultMsg?.obj as WebView.WebViewTransport
                transport.webView = dialogWebView
                resultMsg.sendToTarget()
                return true
            }
        }
        
        // Load the hosted dashboard URL
        webViewDashboard.loadUrl("https://fir-c028b.web.app")

        // Tab Switching Click Listeners
        btnTabMirror.setOnClickListener {
            // Switch UI visibility
            layoutMirroringContent.visibility = View.VISIBLE
            webViewDashboard.visibility = View.GONE
            
            // Update Tab active/inactive colors
            tvTabMirrorText.setTextColor(android.graphics.Color.parseColor("#38BDF8")) // Active color (Blue)
            tvTabDashboardText.setTextColor(android.graphics.Color.parseColor("#94A3B8")) // Inactive color (Grey)
        }

        btnTabDashboard.setOnClickListener {
            // Switch UI visibility
            layoutMirroringContent.visibility = View.GONE
            webViewDashboard.visibility = View.VISIBLE
            
            // Update Tab active/inactive colors
            tvTabMirrorText.setTextColor(android.graphics.Color.parseColor("#94A3B8")) // Inactive color (Grey)
            tvTabDashboardText.setTextColor(android.graphics.Color.parseColor("#38BDF8")) // Active color (Blue)
        }
    }
    private var beaconSocket: DatagramSocket? = null
    private var beaconThread: Thread? = null

    private fun log(msg: String) {
        tvLogs.append("$msg\n")
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(logReceiver)
        stopPassiveBeaconListener()
    }

    private fun startMirroringService(resultCode: Int, data: Intent) {
        log("Requesting Service Start...")
        val intent = Intent(this, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_START
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
            putExtra(ScreenCaptureService.EXTRA_IP, etIpAddress.text.toString())
        }
        stopService(Intent(this, ScreenCaptureService::class.java))
        startForegroundService(intent)
        updateUi()
    }

    private fun stopMirroringService() {
        val intent = Intent(this, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_STOP
        }
        startService(intent)
        isMirroring = false
        updateUi()
        log("Mirroring Stopped")
    }

    private fun getBroadcastAddresses(): List<InetAddress> {
        val addresses = ArrayList<InetAddress>()
        try {
            val interfaces = java.net.NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val networkInterface = interfaces.nextElement()
                if (networkInterface.isLoopback || !networkInterface.isUp) {
                    continue
                }
                for (interfaceAddress in networkInterface.interfaceAddresses) {
                    val broadcast = interfaceAddress.broadcast
                    if (broadcast != null) {
                        addresses.add(broadcast)
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        // Fallback to general broadcast
        try {
            addresses.add(InetAddress.getByName("255.255.255.255"))
        } catch (e: Exception) {}
        return addresses.distinct()
    }

    private fun addDiscoveredIp(ip: String) {
        if (ip.isBlank() || discoveredIps.contains(ip)) return
        discoveredIps.add(ip)
        spinnerAdapter.notifyDataSetChanged()
        log("Found receiver at: $ip")
        // Automatically select and set the newly discovered receiver IP
        etIpAddress.setText(ip)
    }

    private fun startPassiveBeaconListener() {
        beaconThread = Thread {
            try {
                val socket = DatagramSocket(5002).apply {
                    reuseAddress = true
                    soTimeout = 0 // Wait indefinitely
                }
                beaconSocket = socket
                val buffer = ByteArray(1024)
                val packet = DatagramPacket(buffer, buffer.size)

                while (!socket.isClosed) {
                    try {
                        socket.receive(packet)
                        val response = String(packet.data, 0, packet.length).trim()
                        if (response.startsWith("MIRROR_SERVER_BEACON") || response.startsWith("MIRROR_SERVER_OK")) {
                            val parts = response.split(":")
                            if (parts.size > 1) {
                                val ip = parts[1]
                                runOnUiThread {
                                    addDiscoveredIp(ip)
                                }
                            }
                        }
                    } catch (e: Exception) {
                        // ignore timeout or interrupt
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }.apply {
            isDaemon = true
            name = "BeaconListenerThread"
        }
        beaconThread?.start()
    }

    private fun stopPassiveBeaconListener() {
        try {
            beaconSocket?.close()
            beaconThread?.interrupt()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startUdpDiscovery() {
        btnScan.isEnabled = false
        btnScan.text = "Scanning..."
        discoveredIps.clear()
        spinnerAdapter.notifyDataSetChanged()
        log("Starting universal subnet discovery scan...")

        Thread {
            var socket: DatagramSocket? = null
            try {
                socket = DatagramSocket()
                socket.broadcast = true
                socket.soTimeout = 1500

                val message = "DISCOVER_MIRROR_SERVER".toByteArray()
                val broadcastTargets = getBroadcastAddresses()

                // Send discovery packets to ALL broadcast addresses
                for (target in broadcastTargets) {
                    try {
                        log("Scanning subnet via: ${target.hostAddress}")
                        val packet = DatagramPacket(message, message.size, target, 5002)
                        socket.send(packet)
                    } catch (e: Exception) {
                        // ignore write error on specific interface
                    }
                }

                val buffer = ByteArray(1024)
                val receivePacket = DatagramPacket(buffer, buffer.size)

                val startTime = System.currentTimeMillis()
                while (System.currentTimeMillis() - startTime < 2000) {
                    try {
                        socket.receive(receivePacket)
                        val response = String(receivePacket.data, 0, receivePacket.length).trim()
                        if (response.startsWith("MIRROR_SERVER_OK")) {
                            val parts = response.split(":")
                            val ip = if (parts.size > 1) parts[1] else receivePacket.address.hostAddress
                            if (ip != null) {
                                runOnUiThread {
                                    addDiscoveredIp(ip)
                                }
                            }
                        }
                    } catch (e: SocketTimeoutException) {
                        break
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                runOnUiThread { log("Scan error: ${e.message}") }
            } finally {
                socket?.close()
                runOnUiThread {
                    btnScan.isEnabled = true
                    btnScan.text = "Scan for Receivers"
                    if (discoveredIps.isEmpty()) {
                        log("Scan finished. No receivers found.")
                    } else {
                        log("Scan finished. Found ${discoveredIps.size} receiver(s).")
                    }
                }
            }
        }.start()
    }

    private fun updateUi() {
        btnToggle.text = if (isMirroring) getString(R.string.stop_mirroring) else getString(R.string.start_mirroring)
        etIpAddress.isEnabled = !isMirroring
        btnScan.isEnabled = !isMirroring
        spReceivers.isEnabled = !isMirroring
    }

    override fun onBackPressed() {
        val webView = findViewById<WebView>(R.id.webViewDashboard)
        if (webView != null && webView.visibility == View.VISIBLE && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
