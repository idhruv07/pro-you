import socket

def run_server(host='0.0.0.0', port=5001):
    print(f"TEST SERVER listening on {host}:{port}")
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind((host, port))
    server_socket.listen(1)
    
    conn, addr = server_socket.accept()
    print(f"SUCCESS! Connection received from: {addr}")
    conn.close()
    server_socket.close()

if __name__ == "__main__":
    run_server()
