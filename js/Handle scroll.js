function handleScrollEvent() {
    const scrollPosition = window.innerHeight + window.scrollY;
    const totalHeight = document.documentElement.scrollHeight;


    if (scrollPosition >= totalHeight - 100) {


		console.log("Reached the end, loading more posts...")

    }
	windows.addEventListener('scroll',handleScrollEvent)
}