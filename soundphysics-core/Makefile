CXX=g++
CXXFLAGS=-std=c++17 -O2 -Wall

daydream: main.cpp sp/dsp.h sp/daydream.h sp/wav.h
	$(CXX) $(CXXFLAGS) main.cpp -o daydream

clean:
	rm -f daydream daydream_out.wav
