build:
	docker build -t mobile-de-parser .
run:
	docker run -d -p 3000:3000 --name mobile-de-parser --rm mobile-de-parser