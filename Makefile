.PHONY: build watch clean install
default: build

INSTALL_DIR=./node_modules/typescript/bin/
TSC=$(INSTALL_DIR)tsc
	
install:
	npm i

build:
	$(TSC)

watch:
	$(TSC) --watch

clean:
	rm -rf build
